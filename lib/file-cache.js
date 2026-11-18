'use strict';

const fs = require('node:fs');
const { readSnapshot, writeSnapshot } = require('./persistent-cache');

// A file's contribution is replaced atomically after a successful parse. This
// prevents an append/rewrite from adding previously counted rows a second time.
// Callers run disk work in the indexing worker; reads here are intentionally sync.
function createFileCache(parse, io = fs, storage = {}, parseFile) {
  const entries = new Map();
  let diagnostics = { files: 0, parseErrors: 0, readErrors: 0, lastSuccessfulAt: null };
  let dirty = false, restoredFiles = 0, persistenceError = null;
  const saved = storage.filename && readSnapshot(storage.filename, storage.identity, io);
  if (saved && Array.isArray(saved.entries) && saved.entries.every(row => Array.isArray(row) && row.length === 2
    && typeof row[0] === 'string' && typeof row[1]?.fingerprint === 'string' && Array.isArray(row[1].records))) {
    for (const [filename, entry] of saved.entries) entries.set(filename, entry);
    restoredFiles = entries.size;
    diagnostics.lastSuccessfulAt = saved.lastSuccessfulAt || null;
  }
  function update(files, force = false, discoveryErrors = 0) {
    const active = new Set(files);
    let readErrors = discoveryErrors, reusedFiles = 0, parsedFiles = 0, bytesRead = 0;
    for (const filename of active) {
      try {
        const stat = io.statSync(filename);
        const fingerprint = [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':');
        if (!force && entries.get(filename)?.fingerprint === fingerprint) { reusedFiles++; continue; }
        const parsed = parseFile ? parseFile(filename, stat, io) : parse(io.readFileSync(filename, 'utf8'), filename, stat);
        parsedFiles++; bytesRead += stat.size; dirty = true;
        entries.set(filename, { fingerprint, records: parsed.records, parseErrors: parsed.parseErrors || 0,
          pendingLines: parsed.pendingLines || 0, undatedRecords: parsed.undatedRecords || 0 });
      } catch (error) {
        // A failed read retains the last good contribution, explicitly stale.
        if (error.code === 'ENOENT') { dirty = entries.delete(filename) || dirty; }
        else readErrors++;
      }
    }
    // A failed traversal cannot establish that a previously indexed file was deleted.
    if (!discoveryErrors) for (const filename of entries.keys()) if (!active.has(filename)) { entries.delete(filename); dirty = true; }
    diagnostics = { files: entries.size, readErrors,
      parseErrors: [...entries.values()].reduce((sum, entry) => sum + entry.parseErrors, 0),
      pendingLines: [...entries.values()].reduce((sum, entry) => sum + entry.pendingLines, 0),
      undatedRecords: [...entries.values()].reduce((sum, entry) => sum + entry.undatedRecords, 0),
      lastSuccessfulAt: readErrors ? diagnostics.lastSuccessfulAt : new Date().toISOString(),
      restoredFiles, reusedFiles, parsedFiles, bytesRead };
    if (storage.filename && dirty) {
      persistenceError = writeSnapshot(storage.filename, storage.identity,
        { entries: [...entries], lastSuccessfulAt: diagnostics.lastSuccessfulAt }, io);
      if (!persistenceError) dirty = false;
    }
    diagnostics.persistenceError = persistenceError;
    return [...entries.values()].flatMap(entry => entry.records);
  }
  return { update, diagnostics: () => ({ ...diagnostics }), clear: () => entries.clear() };
}

module.exports = { createFileCache };
