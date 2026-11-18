'use strict';

// ccusage currently reads .jsonl only. Give it a compact, complete view of
// both active logs and compressed archives without changing the user's logs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const zlib = require('zlib');
const { once } = require('events');
const { finished } = require('stream/promises');

const CODEX_INPUT_VERSION = 4;
const fields = (value, names) => Object.fromEntries(names.filter(name => value?.[name] !== undefined)
  .map(name => [name, value[name]]));

function usageRecord(record) {
  if (record.type === 'session_meta') return record;
  if (record.type === 'turn_context') {
    const payload = fields(record.payload, ['model', 'cwd', 'service_tier', 'model_provider']);
    if (record.payload?.collaboration_mode) {
      payload.collaboration_mode = { ...fields(record.payload.collaboration_mode, ['mode']),
        settings: fields(record.payload.collaboration_mode.settings, ['model', 'service_tier', 'reasoning_effort']) };
    }
    return { ...fields(record, ['type', 'timestamp']), payload };
  }
  if (record.type === 'event_msg' && ['token_count', 'thread_settings_applied'].includes(record.payload?.type)) return record;
  return null;
}

async function projectLog(sourcePath, outputPath) {
  // Set up the destination before opening the reader. readline starts flowing
  // immediately; awaiting mkdir afterward can lose a small file's first rows.
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const source = fs.createReadStream(sourcePath);
  const input = sourcePath.endsWith('.zst') ? source.pipe(zlib.createZstdDecompress()) : source;
  if (input !== source) source.on('error', error => input.destroy(error));
  input.setEncoding('utf8');
  let endsWithNewline = true;
  const trackTail = chunk => { endsWithNewline = chunk.endsWith('\n'); };
  input.on('data', trackTail);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  const output = fs.createWriteStream(temporary);
  // Observe output errors immediately, including before the next drain wait.
  const completed = finished(output);
  completed.catch(() => {});
  let records = 0, parseErrors = 0, pendingLines = 0, lastMalformed = false;
  try {
    for await (const line of lines) {
      lastMalformed = false;
      if (!line.includes('"token_count"') && !line.includes('"turn_context"')
        && !line.includes('"session_meta"') && !line.includes('"thread_settings_applied"')) continue;
      let record;
      try { record = usageRecord(JSON.parse(line)); }
      catch (_) { parseErrors++; lastMalformed = true; continue; }
      if (!record) continue;
      if (!output.write(`${JSON.stringify(record)}\n`)) await once(output, 'drain');
      records++;
    }
    output.end();
    await completed;
    await fs.promises.rename(temporary, outputPath);
    if (lastMalformed && !endsWithNewline) { parseErrors--; pendingLines++; }
    return { records, parseErrors, pendingLines };
  } catch (error) {
    output.destroy();
    await completed.catch(() => {});
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  } finally {
    input.removeListener('data', trackTail);
    lines.close();
    input.destroy();
    source.destroy();
  }
}

async function prepareCodexInput(options = {}) {
  const home = path.resolve(options.home || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const key = crypto.createHash('sha256').update(home).digest('hex').slice(0, 16);
  const cacheRoot = path.resolve(options.cacheRoot || path.join(require('./config').cacheDir, 'ccusage-codex-input'));
  const inputHome = path.join(cacheRoot, key);
  const manifestPath = path.join(inputHome, 'manifest.json');
  let previous = {};
  let previousVersion = null;
  try {
    const saved = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    if (saved.home === home) { previous = saved.files || {}; previousVersion = saved.version; }
  } catch (_) { /* First build or interrupted manifest write. */ }

  const files = [], visited = new Set();
  async function visit(directory) {
    let real;
    try { real = await fs.promises.realpath(directory); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && (filename.endsWith('.jsonl') || filename.endsWith('.jsonl.zst'))) files.push(filename);
    }
  }
  await visit(path.join(home, 'sessions'));
  await visit(path.join(home, 'archived_sessions'));
  if (files.some(filename => filename.endsWith('.zst')) && typeof zlib.createZstdDecompress !== 'function') {
    throw new Error('Compressed Codex archives require a Node.js runtime with Zstandard support');
  }
  await fs.promises.mkdir(path.join(inputHome, 'sessions'), { recursive: true });
  await fs.promises.mkdir(path.join(inputHome, 'archived_sessions'), { recursive: true });

  const manifest = {}, outputPaths = new Set();
  let index = 0, changedFiles = 0;
  const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (index < files.length) {
      const filename = files[index++];
      const relative = path.relative(home, filename);
      // Separate sibling .jsonl and .jsonl.zst copies while preserving each
      // original basename; ccusage identifies sessions from the log metadata.
      const identity = crypto.createHash('sha256').update(relative).digest('hex').slice(0, 16);
      const outputPath = path.join(inputHome, 'sessions', identity, path.basename(filename).replace(/\.zst$/, ''));
      outputPaths.add(outputPath);
      const stat = await fs.promises.stat(filename);
      const saved = previous[relative];
      const unchanged = previousVersion === CODEX_INPUT_VERSION && saved?.size === stat.size && saved?.mtimeMs === stat.mtimeMs
        && saved?.ctimeMs === stat.ctimeMs && saved?.ino === stat.ino
        && fs.existsSync(outputPath);
      const details = unchanged ? { records: saved.records, parseErrors: saved.parseErrors, pendingLines: saved.pendingLines }
        : await projectLog(filename, outputPath);
      if (!unchanged) changedFiles++;
      manifest[relative] = { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, ...details, outputPath };
    }
  }));
  const failed = workers.find(worker => worker.status === 'rejected');
  if (failed) throw failed.reason;
  // Remove only derived files that no longer have a source. Verify all cached
  // paths before unlinking; a manifest must never direct deletion elsewhere.
  for (const saved of Object.values(previous)) {
    if (typeof saved.outputPath !== 'string') continue;
    const target = path.resolve(saved.outputPath);
    if (target.startsWith(`${inputHome}${path.sep}`) && !outputPaths.has(target)) {
      await fs.promises.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  // Preserve ccusage's existing auto-speed configuration for the mirror.
  // Authentication files and original logs are never copied or modified.
  const config = path.join(home, 'config.toml');
  const mirroredConfig = path.join(inputHome, 'config.toml');
  if (fs.existsSync(config)) await fs.promises.copyFile(config, mirroredConfig);
  else await fs.promises.unlink(mirroredConfig).catch(error => { if (error.code !== 'ENOENT') throw error; });

  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryManifest, JSON.stringify({ version: CODEX_INPUT_VERSION, home, files: manifest }));
  await fs.promises.rename(temporaryManifest, manifestPath);
  return { home: inputHome, roots: [path.join(inputHome, 'sessions')], version: CODEX_INPUT_VERSION,
    signature: crypto.createHash('sha256').update(JSON.stringify([CODEX_INPUT_VERSION,
      Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
      fs.existsSync(config) ? await fs.promises.readFile(config, 'utf8') : null])).digest('hex'),
    changedFiles, reusedFiles: files.length - changedFiles,
    parseErrors: Object.values(manifest).reduce((sum, file) => sum + (file.parseErrors || 0), 0),
    pendingLines: Object.values(manifest).reduce((sum, file) => sum + (file.pendingLines || 0), 0),
    fileCount: files.length, compressedFileCount: files.filter(filename => filename.endsWith('.zst')).length };
}

module.exports = { prepareCodexInput, CODEX_INPUT_VERSION };
