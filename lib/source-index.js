'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createFileCache } = require('./file-cache');
const { hash, getRuntimeIdentity, snapshotPath } = require('./persistent-cache');

function discover(paths, accept = filename => filename.endsWith('.jsonl'), io = fs) {
  const files = new Set(), visited = new Set();
  let readErrors = 0, available = false;
  function visit(filename, depth = 0) {
    if (depth > 32) { readErrors++; return; }
    try {
      const real = io.realpathSync(filename);
      const stat = io.statSync(real);
      available = true;
      if (stat.isFile()) { if (accept(real)) files.add(real); return; }
      if (!stat.isDirectory() || visited.has(real)) return;
      visited.add(real);
      for (const entry of io.readdirSync(real, { withFileTypes: true })) {
        const child = path.join(real, entry.name);
        // Dirents already identify regular files. Avoid resolving and statting
        // every unrelated image/artifact in an agent's history tree.
        if (entry.isDirectory()) visit(child, depth + 1);
        else if (entry.isFile() && accept(child)) visit(child, depth + 1);
      }
    } catch (error) { if (error.code !== 'ENOENT') readErrors++; }
  }
  for (const filename of paths) visit(filename);
  return { files: [...files], readErrors, available };
}

function createSourceIndex({ source, paths, accept, parse, ttlMs = 60_000, io = fs, now = () => Date.now(),
  persist = io === fs, parserVersion = 1, parseFile }) {
  let cache;
  let records = [], checkedAt = 0, lastSuccessfulAt = null, currentPaths = [], status = {};
  function getRecords(force = false) {
    const nextPaths = paths().filter(Boolean).map(filename => path.resolve(filename));
    const changed = JSON.stringify(nextPaths) !== JSON.stringify(currentPaths);
    if (!force && !changed && checkedAt && now() - checkedAt < ttlMs) return records;
    if (changed || !cache) {
      const identity = hash([getRuntimeIdentity(), source, nextPaths, parserVersion]);
      cache = createFileCache(parse, io, persist ? { filename: snapshotPath('sources', identity), identity } : {}, parseFile);
      lastSuccessfulAt = null;
    }
    currentPaths = nextPaths;
    const found = discover(currentPaths, accept, io);
    // Force means check for changes now; it never discards valid file results.
    records = cache.update(found.files, false, found.readErrors);
    const details = cache.diagnostics();
    checkedAt = now();
    const partial = details.readErrors > 0 || details.parseErrors > 0 || details.undatedRecords > 0;
    if (!partial) lastSuccessfulAt = new Date(checkedAt).toISOString();
    const dates = records.map(record => record.date).filter(Boolean).sort();
    const identityAssumptions = records.filter(record => record.pricingContext?.usageIdentity === 'session-gateway-message-id').length;
    status = { source, paths: [...currentPaths], available: found.available,
      ...(identityAssumptions ? { identityAssumptions,
        pathNotice: '部分兼容日志缺少 requestId 且使用网关消息 ID；按会话内消息 ID 去重并保留完整快照。网关若在不同请求中复用消息 ID，用量身份无法精确核对。' } : {}),
      status: partial ? 'partial' : !found.available ? 'unavailable' : records.length ? 'ready' : 'empty',
      checkedAt: new Date(checkedAt).toISOString(), lastSuccessfulAt, stale: partial, refreshing: false,
      files: details.files, parseErrors: details.parseErrors, readErrors: details.readErrors,
      pendingLines: details.pendingLines, undatedRecords: details.undatedRecords,
      index: { restoredFiles: details.restoredFiles, reusedFiles: details.reusedFiles,
        parsedFiles: details.parsedFiles, bytesRead: details.bytesRead, persistenceError: details.persistenceError },
      coverage: { from: dates[0] || null, to: dates.at(-1) || null },
      error: partial ? 'Some records could not be read, parsed or dated; last valid contributions are retained.' : null };
    return records;
  }
  return { getRecords, getDiagnostics: () => ({ ...status, paths: [...currentPaths],
    stale: !!status.stale || (!!checkedAt && now() - checkedAt >= ttlMs) }),
    invalidate: () => { checkedAt = 0; } };
}

// A partial live tail is retried after file growth, not treated as a bad completed row.
function parseLines(content, consume) {
  const lines = content.split('\n');
  let parseErrors = 0, pendingLines = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    let value;
    try { value = JSON.parse(line); }
    catch (_) { if (index === lines.length - 1 && !content.endsWith('\n')) pendingLines++; else parseErrors++; continue; }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      try { consume(value, index); } catch (_) { parseErrors++; }
    }
  }
  return { parseErrors, pendingLines };
}

module.exports = { createSourceIndex, discover, parseLines };
