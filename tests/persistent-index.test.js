'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createSourceIndex } = require('../lib/source-index');
const { parseUsageLog } = require('../lib/log-parsers');
const { createIndexClient } = require('../lib/index-client');
const { hash, snapshotPath } = require('../lib/persistent-cache');
const { readJsonLines } = require('../lib/jsonl-reader');

function fixture(name) {
  const directory = path.join(process.env.HOME, name);
  fs.mkdirSync(directory, { recursive: true });
  const root = fs.realpathSync(directory);
  const row = input => JSON.stringify({ timestamp: '2026-10-20T04:00:00Z', model: 'qwen-plus',
    usageMetadata: { promptTokenCount: input, candidatesTokenCount: 20 } }) + '\n';
  const first = path.join(root, 'first.jsonl'), second = path.join(root, 'second.jsonl');
  fs.writeFileSync(first, row(100)); fs.writeFileSync(second, row(200));
  let reads = [], snapshots = [], rejectWrites = false;
  const io = { ...fs, readFileSync(filename, ...args) {
    if (filename.startsWith(root)) reads.push(filename);
    return fs.readFileSync(filename, ...args);
  }, renameSync(from, to) {
    if (rejectWrites) throw Object.assign(new Error('fixture disk unavailable'), { code: 'EACCES' });
    if (to.endsWith('.json')) snapshots.push(to);
    return fs.renameSync(from, to);
  } };
  const index = (parserVersion = 1) => createSourceIndex({ source: 'qwen', paths: () => [root],
    parse: (content, name) => parseUsageLog('qwen', content, name), io, persist: true, parserVersion });
  const total = source => source.getRecords(true).reduce((sum, row) => sum + row.totalTokens, 0);
  return { root, first, second, row, index, total, reset: () => { reads.length = 0; },
    reads, snapshots, setRejectWrites: value => { rejectWrites = value; } };
}

test('restart and manual refresh reuse durable file results; appends, truncation and deletion replace only changed contributions', () => {
  const f = fixture('durable-lifecycle');
  assert.equal(f.total(f.index()), 340);
  assert.equal(f.reads.length, 2);
  f.reset();
  const restarted = f.index();
  assert.equal(f.total(restarted), 340);
  assert.equal(f.reads.length, 0, 'A restarted index must not reread unchanged log contents');
  assert.equal(restarted.getDiagnostics().index.restoredFiles, 2);
  assert.equal(f.total(restarted), 340);
  assert.equal(f.reads.length, 0, 'Manual refresh is incremental too');
  const mtime = fs.statSync(f.first).mtime;
  fs.appendFileSync(f.first, f.row(300)); fs.utimesSync(f.first, mtime, mtime);
  assert.equal(f.total(restarted), 660);
  assert.deepEqual(f.reads, [f.first]);
  f.reset();
  fs.writeFileSync(f.first, f.row(50));
  assert.equal(f.total(f.index()), 290);
  assert.deepEqual(f.reads, [f.first]);
  f.reset(); fs.unlinkSync(f.second);
  assert.equal(f.total(f.index()), 70);
  assert.equal(f.reads.length, 0);
  const newFile = path.join(f.root, 'rotated.jsonl'); fs.renameSync(f.first, newFile);
  assert.equal(f.total(f.index()), 70, 'A rotation must not keep the old contribution as well');
  assert.deepEqual(f.reads, [newFile]);
});

test('corrupt or incompatible derived indexes rebuild safely, while interrupted saves preserve the previous snapshot', () => {
  const f = fixture('durable-recovery');
  assert.equal(f.total(f.index()), 340);
  const filename = f.snapshots.at(-1), before = fs.readFileSync(filename, 'utf8');
  f.reset(); f.setRejectWrites(true); fs.appendFileSync(f.first, f.row(50));
  const failedSave = f.index();
  assert.equal(f.total(failedSave), 410);
  assert.ok(failedSave.getDiagnostics().index.persistenceError);
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
  f.reset(); f.setRejectWrites(false);
  assert.equal(f.total(failedSave), 410);
  assert.equal(f.reads.length, 0, 'Retrying a disk save must not reparse unchanged logs');
  const corrupt = JSON.parse(fs.readFileSync(filename, 'utf8'));
  corrupt.data.entries = []; // A valid JSON file with a mismatched checksum is not a valid index.
  fs.writeFileSync(filename, JSON.stringify(corrupt)); f.reset();
  assert.equal(f.total(f.index()), 410);
  assert.equal(f.reads.length, 2);
  f.reset(); assert.equal(f.total(f.index(2)), 410);
  assert.equal(f.reads.length, 2, 'A parser version change must not reuse the old parse');
});

test('dashboard restart serves the saved snapshot immediately, then replaces it after background verification', async t => {
  const workerFile = path.join(__dirname, 'fixtures/index-worker.cjs');
  const options = { workerFile, snapshotIdentity: 'durable-dashboard-test' };
  const args = { delay: 100 };
  const first = createIndexClient(options);
  assert.equal((await first.query('dashboard', args)).totals.totalTokens, 1);
  await first.dispose();
  const next = createIndexClient(options); t.after(() => next.dispose());
  const restored = await next.query('dashboard', args, { maxWaitMs: 1 });
  assert.equal(restored.meta.fromDiskCache, true);
  assert.equal(restored.meta.stale, true);
  assert.equal(restored.meta.refreshing, true);
  assert.equal(restored.meta.lastSuccessfulAt, '2026-10-18T00:00:00Z');
  await next.call('dashboard', args);
  assert.equal((await next.query('dashboard', args)).meta.fromDiskCache, undefined);
  const identity = hash([options.snapshotIdentity, JSON.stringify(['dashboard', args])]);
  fs.writeFileSync(snapshotPath('dashboards', identity), '{broken snapshot');
  const broken = createIndexClient(options); t.after(() => broken.dispose());
  await assert.rejects(broken.query('dashboard', args, { maxWaitMs: 1 }), error => error.statusCode === 503);
});

test('unchanged Codex inputs reuse the native report even across processes; changed inputs still rebuild', () => {
  const source = `
    const cp = require('node:child_process'); let spawns = 0;
    const spawn = cp.spawn; cp.spawn = (...args) => { spawns++; return spawn(...args); };
    const loader = require('./lib/codex-loader');
    (async () => {
      if (!await loader.forceRefresh()) throw new Error(loader.getStatus().error);
      const first = spawns;
      if (!await loader.forceRefresh()) throw new Error(loader.getStatus().error);
      console.log(JSON.stringify({ first, spawns, index: loader.getStatus().index }));
      await loader.stopAndFlush();
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const run = () => JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' }));
  const initial = run();
  assert.equal(initial.first, 1);
  assert.equal(initial.spawns, 1);
  assert.equal(initial.index.nativeReportReused, true);
  assert.equal(run().spawns, 0, 'A new process must also reuse unchanged native report inputs');
  fs.mkdirSync(process.env.CLAUDE_SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.CLAUDE_SESSIONS_DIR, 'new.jsonl'), '{}\n');
  assert.equal(run().first, 1, 'A changed external agent input must invalidate the unified report');
});

test('Codex request history survives process restarts and only modified logs are reparsed', () => {
  const root = path.join(process.env.HOME, 'durable-codex-requests'); fs.mkdirSync(root, { recursive: true });
  const filename = path.join(root, 'request.jsonl');
  const usage = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, total_tokens: 120 };
  const row = total => ({ type: 'event_msg', timestamp: '2026-10-20T04:00:00Z', payload: { type: 'token_count',
    info: { total_token_usage: { ...usage, total_tokens: total }, last_token_usage: usage } } });
  fs.writeFileSync(filename, [ { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }, row(120) ]
    .map(row => JSON.stringify(row)).join('\n') + '\n');
  const source = `require('./lib/codex-request-usage').enrichCodexUsage({daily:[]}, {roots:[${JSON.stringify(root)}]})
    .then(data => console.log(JSON.stringify({index: data.requestIndex, requests: data.requestRecords.length})));`;
  const run = () => JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' }));
  assert.equal(run().index.parsedFiles, 1);
  const restarted = run();
  assert.equal(restarted.index.parsedFiles, 0);
  assert.equal(restarted.index.reusedFiles, 1);
  assert.equal(restarted.requests, 1);
  fs.appendFileSync(filename, JSON.stringify(row(240)) + '\n');
  const updated = run();
  assert.equal(updated.index.parsedFiles, 1);
  assert.equal(updated.requests, 2);
});

test('ZCode persisted records detect database and WAL updates without querying an unchanged database', {
  skip: !require('../lib/runtime-capabilities').getRuntimeCapabilities().sqlite
}, () => {
  const { DatabaseSync } = require('node:sqlite');
  const root = path.join(process.env.HOME, 'durable-zcode'); fs.mkdirSync(root, { recursive: true });
  const filename = path.join(root, 'usage.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE model_usage (id TEXT, started_at INTEGER, model_id TEXT, input_tokens INTEGER, output_tokens INTEGER)');
  const insert = db.prepare('INSERT INTO model_usage VALUES (?, ?, ?, ?, ?)');
  insert.run('first', Date.parse('2026-10-20T04:00:00Z'), 'GLM-5.3-Flash', 100, 20);
  const source = `const s = require('./lib/zcode-source'); const records = s.getRecords('standard', true);
    console.log(JSON.stringify({count: records.length, index: s.getDiagnostics().index}));`;
  const run = () => JSON.parse(execFileSync(process.execPath, ['-e', source],
    { encoding: 'utf8', env: { ...process.env, ZCODE_DB_PATH: filename }, stdio: ['ignore', 'pipe', 'ignore'] }));
  try {
    assert.equal(run().count, 1);
    assert.equal(run().index.reused, true);
    insert.run('second', Date.parse('2026-10-20T05:00:00Z'), 'GLM-5.3-Flash', 200, 40);
    const changed = run();
    assert.equal(changed.count, 2);
    assert.equal(changed.index.reused, false);
    assert.equal(run().index.reused, true);
  } finally { db.close(); }
});

test('image metadata streams across UTF-8 boundaries and skips oversized unrelated payloads', () => {
  const root = path.join(process.env.HOME, 'streamed-metadata'); fs.mkdirSync(root, { recursive: true });
  const filename = path.join(root, 'images.jsonl');
  const row = { payload: { type: 'image_generation_end', prompt: '中文图片测试', saved_path: '/fixture/a.png' } };
  const accept = value => value.includes('image_generation_end');
  fs.writeFileSync(filename, JSON.stringify(row) + '\n');
  const tiny = [];
  assert.deepEqual(readJsonLines(filename, row => tiny.push(row), { accept, chunkSize: 7 }), { parseErrors: 0, pendingLines: 0 });
  assert.deepEqual(tiny, [row]);
  fs.writeFileSync(filename, JSON.stringify({ unrelated: 'x'.repeat(2 * 1024 * 1024) }) + '\n'
    + JSON.stringify(row) + '\n' + '{"image_generation_end":broken}\n' + '{"image_generation_end":');
  const parsed = [];
  const result = readJsonLines(filename, row => parsed.push(row), { accept, chunkSize: 1024,
    discard: value => value.startsWith('{"unrelated":') });
  assert.deepEqual(parsed, [row]);
  assert.deepEqual(result, { parseErrors: 1, pendingLines: 1 });
});
