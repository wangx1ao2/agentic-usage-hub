'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSourceIndex, discover } = require('./source-index');
const { codexHome } = require('./config');
const { timestampMs } = require('./request-record');
const { getLocalDateStr } = require('./date');
const { readJsonLines } = require('./jsonl-reader');
const metadata = createSourceIndex({ source: 'image-metadata', paths: () => [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')],
  parseFile(filename, stat, io) {
    const records = [];
    const diagnostics = readJsonLines(filename, row => {
      const p = row?.payload || {};
      if (!['image_generation_end', 'image_generation_call'].includes(p.type)) return;
      records.push({ id: p.call_id || p.id, savedPath: p.saved_path, prompt: p.prompt || p.revised_prompt,
        timestamp: row.timestamp, status: p.status });
    }, { io, size: stat.size,
      accept: line => line.includes('image_generation_end') || line.includes('image_generation_call'),
      discard: line => {
        // Only discard a large line after its structural type proves it is
        // unrelated. Metadata with a late type field must still be retained.
        const type = line.match(/^\s*\{(?:\s*"timestamp"\s*:\s*"[^"]*"\s*,)?\s*"type"\s*:\s*"([^"]+)"/)?.[1];
        const payloadType = line.match(/"payload"\s*:\s*\{\s*"type"\s*:\s*"([^"]+)"/)?.[1];
        return ['turn_context', 'session_meta'].includes(type) || (type === 'response_item' && !!payloadType
          && !['image_generation_end', 'image_generation_call'].includes(payloadType));
      } });
    return { records, ...diagnostics };
  } });
let checkedAt = 0, lastSuccessfulAt = null, catalog = [], status = {}, previousRoots = '';
const files = new Map();
function imageRoots() {
  return [...new Set([...(process.env.CODEX_IMAGE_DIRS || '').split(path.delimiter), process.env.CODEX_IMAGE_DIR,
    path.join(codexHome, 'generated_images')].filter(value => value?.trim()).map(value => path.resolve(value.trim())))];
}
function getCatalog(force = false) {
  const roots = imageRoots(), identity = JSON.stringify(roots);
  if (!force && identity === previousRoots && checkedAt && Date.now() - checkedAt < 30_000) return catalog;
  if (identity !== previousRoots) { files.clear(); lastSuccessfulAt = null; }
  previousRoots = identity;
  const meta = metadata.getRecords(force), metaStatus = metadata.getDiagnostics();
  const byPath = new Map(), byId = new Map();
  for (const row of meta) {
    if (typeof row.savedPath === 'string') byPath.set(path.resolve(row.savedPath).toLowerCase(), row);
    if (row.id) byId.set(String(row.id), row);
  }
  const found = discover(roots, filename => /\.png$/i.test(filename));
  const active = new Set(found.files);
  let readErrors = found.readErrors + (metaStatus.readErrors || 0);
  for (const filename of active) {
    try {
      const stat = fs.statSync(filename), basename = path.basename(filename), callId = basename.replace(/\.png$/i, '');
      const row = byPath.get(filename.toLowerCase()) || byId.get(callId) || {};
      const timestamp = timestampMs(row.timestamp) ?? stat.mtimeMs;
      files.set(filename, { id: createHash('sha256').update(filename).digest('hex').slice(0, 24), filename: basename,
        filePath: filename, fileSize: (stat.size / 1024).toFixed(0) + ' KB',
        date: getLocalDateStr(new Date(timestamp)), timestamp: new Date(timestamp).toISOString(),
        prompt: row.prompt || 'Codex 自动化生图工具任务', status: row.status || 'generated' });
    } catch (error) { if (error.code === 'ENOENT') files.delete(filename); else readErrors++; }
  }
  if (!found.readErrors) for (const filename of files.keys()) if (!active.has(filename)) files.delete(filename);
  catalog = [...files.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  checkedAt = Date.now();
  const parseErrors = metaStatus.parseErrors || 0;
  if (!readErrors && !parseErrors) lastSuccessfulAt = new Date(checkedAt).toISOString();
  const dates = catalog.map(row => row.date).sort();
  status = { source: 'images', paths: roots, metadataPaths: metaStatus.paths,
    available: found.available, files: catalog.length, readErrors, parseErrors,
    pendingLines: metaStatus.pendingLines || 0, checkedAt: new Date(checkedAt).toISOString(), lastSuccessfulAt,
    index: metaStatus.index,
    stale: !!(readErrors || parseErrors), refreshing: false,
    status: readErrors || parseErrors ? 'partial' : !found.available ? 'unavailable' : catalog.length ? 'ready' : 'empty',
    coverage: { from: dates[0] || null, to: dates.at(-1) || null },
    error: readErrors || parseErrors ? 'Some image files or metadata could not be indexed.' : null };
  return catalog;
}

module.exports = { getCatalog, imageRoots, getDiagnostics: () => ({ ...status,
  stale: !!status.stale || (!!checkedAt && Date.now() - checkedAt >= 30_000) }) };
