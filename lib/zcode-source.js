'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequestRecord, timestampMs } = require('./request-record');
const { getRuntimeCapabilities } = require('./runtime-capabilities');
const { hash, getRuntimeIdentity, snapshotPath, readSnapshot, writeSnapshot } = require('./persistent-cache');
let raw = [], checkedAt = 0, lastSuccessfulAt = null, status = {}, previousPath = '';
let storage, savedFingerprint = null, savedStatus = null, persistDirty = false;

function databaseFingerprint(filename) {
  return [filename, `${filename}-wal`].map(file => {
    try { const stat = fs.statSync(file); return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]; }
    catch (error) { if (file !== filename && error.code === 'ENOENT') return null; throw error; }
  });
}

function getRecords(tier = 'standard', force = false) {
  const dbPath = path.resolve(process.env.ZCODE_DB_PATH || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite'));
  if (dbPath !== previousPath) {
    raw = []; checkedAt = 0; lastSuccessfulAt = null; previousPath = dbPath;
    storage = hash([getRuntimeIdentity(), dbPath]);
    const saved = readSnapshot(snapshotPath('zcode', storage), storage);
    savedFingerprint = null; savedStatus = null; persistDirty = false;
    if (saved && Array.isArray(saved.raw) && typeof saved.fingerprint === 'string' && saved.status) {
      raw = saved.raw; savedFingerprint = saved.fingerprint; savedStatus = saved.status;
      lastSuccessfulAt = saved.status.lastSuccessfulAt;
    }
  }
  if (force || !checkedAt || Date.now() - checkedAt >= 60_000) {
    let db;
    const next = [];
    let parseErrors = 0, undatedRecords = 0;
    status = { source: 'zcode', paths: [dbPath], available: false, readErrors: 0, parseErrors: 0,
      undatedRecords: 0, stale: false, refreshing: false, lastSuccessfulAt };
    try {
      const stat = fs.statSync(dbPath);
      status.available = stat.isFile();
      const fingerprint = JSON.stringify(databaseFingerprint(dbPath));
      if (fingerprint === savedFingerprint && savedStatus && !savedStatus.stale) {
        status = { ...savedStatus, index: { reused: true, rows: raw.length } };
        lastSuccessfulAt = new Date().toISOString();
      } else {
        if (!getRuntimeCapabilities().sqlite) throw new Error('This runtime does not support node:sqlite');
        const { DatabaseSync } = require('node:sqlite');
        db = new DatabaseSync(dbPath, { readOnly: true });
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
        if (!tables.has('model_usage') && !tables.has('part')) throw new Error('Unsupported ZCode database schema');
        const rows = tables.has('model_usage') ? db.prepare('SELECT * FROM model_usage ORDER BY started_at').all() : [];
        const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
        const sessionColumns = tables.has('session') ? columns('session') : new Set();
        const sessions = sessionColumns.has('id') && sessionColumns.has('directory')
          ? new Map(db.prepare('SELECT id, directory FROM session').all().map(row => [row.id, row.directory])) : new Map();
        for (let index = 0; index < rows.length; index++) {
          const row = rows[index], cache = Number(row.cache_read_input_tokens) || 0;
          const record = { id: row.id || `${row.session_id}:${row.started_at}:${index}`, model: row.model_id || 'unknown',
            timestamp: row.started_at, sessionId: row.session_id, projectPath: sessions.get(row.session_id),
            inputTokens: Math.max(0, (Number(row.input_tokens) || 0) - cache), cacheReadTokens: cache,
            cacheWriteTokens: row.cache_creation_input_tokens || row.cache_write_tokens || 0,
            outputTokens: row.output_tokens, totalTokens: row.computed_total_tokens };
          if (createRequestRecord({ ...record, source: 'zcode' })) next.push(record); else undatedRecords++;
        }
        // Old step-finish records are read only before the actual model_usage
        // cutover, instead of an author-specific date or an assumed model name.
        const cutover = rows.reduce((min, row) => timestampMs(row.started_at) !== null ? Math.min(min, timestampMs(row.started_at)) : min, Infinity);
        if (tables.has('part')) {
          const messageColumns = tables.has('message') ? columns('message') : new Set();
          const messages = messageColumns.has('id') && messageColumns.has('session_id')
            ? new Map(db.prepare('SELECT id, session_id FROM message').all().map(row => [row.id, row.session_id])) : new Map();
          for (const row of db.prepare('SELECT * FROM part ORDER BY time_created').all()) {
            if (timestampMs(row.time_created) === null) { undatedRecords++; continue; }
            if (!(timestampMs(row.time_created) < cutover) || !String(row.data).includes('step-finish')) continue;
            try {
              const item = JSON.parse(row.data);
              if (item.type !== 'step-finish' || !item.tokens) continue;
              const cache = Number(item.tokens.cache?.read) || 0;
              const sessionId = messages.get(row.message_id);
              next.push({ id: `part:${row.id || row.message_id}:${row.time_created}`,
                model: item.model || item.modelID || 'unknown', timestamp: row.time_created, sessionId,
                projectPath: sessions.get(sessionId), inputTokens: Math.max(0, (Number(item.tokens.input) || 0) - cache),
                cacheReadTokens: cache, cacheWriteTokens: item.tokens.cache?.write || 0,
                outputTokens: item.tokens.output, totalTokens: item.tokens.total });
            } catch (_) { parseErrors++; }
          }
        }
        raw = next;
        if (!parseErrors && !undatedRecords) lastSuccessfulAt = new Date().toISOString();
        status.parseErrors = parseErrors; status.undatedRecords = undatedRecords;
        status.stale = !!(parseErrors || undatedRecords);
        status.index = { reused: false, rows: raw.length };
        // Capture only the database generation we actually read. WAL changes
        // during the read are detected on the next refresh and never skipped.
        if (fingerprint === JSON.stringify(databaseFingerprint(dbPath))) {
          savedFingerprint = fingerprint; savedStatus = { ...status, lastSuccessfulAt };
          persistDirty = true;
        }
      }
      if (persistDirty && savedFingerprint === fingerprint) {
        status.index.persistenceError = writeSnapshot(snapshotPath('zcode', storage), storage,
          { raw, fingerprint, status: savedStatus });
        persistDirty = !!status.index.persistenceError;
      }
    } catch (error) {
      if (error.code === 'ENOENT') { raw = []; lastSuccessfulAt = new Date().toISOString(); }
      else { status.readErrors = 1; status.stale = true; status.error = error.message; }
    } finally { try { db?.close(); } catch (_) { status.readErrors = 1; status.stale = true; } }
    checkedAt = Date.now();
    status.lastSuccessfulAt = lastSuccessfulAt;
    status.checkedAt = new Date(checkedAt).toISOString();
    status.status = status.stale ? 'partial' : !status.available ? 'unavailable' : raw.length ? 'ready' : 'empty';
  }
  const result = raw.map(row => createRequestRecord({ ...row, source: 'zcode', rawModel: row.model,
    model: `${row.model} (ZCode)`, tier })).filter(Boolean);
  const dates = result.map(row => row.date).sort();
  status.coverage = { from: dates[0] || null, to: dates.at(-1) || null };
  return result;
}

module.exports = { getRecords, getDiagnostics: () => ({ ...status, stale: !!status.stale || (!!checkedAt && Date.now() - checkedAt >= 60_000) }) };
