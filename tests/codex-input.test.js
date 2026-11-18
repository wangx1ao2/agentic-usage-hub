const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { prepareCodexInput } = require('../lib/codex-input');
const { enrichCodexUsage } = require('../lib/codex-request-usage');

const supportsZstd = typeof zlib.createZstdDecompress === 'function';
const cli = path.resolve(__dirname, '../node_modules/ccusage/src/cli.js');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-hub-complete-input-'));
  const home = path.join(root, 'home');
  const cacheRoot = path.join(root, 'cache');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, 'archived_sessions'), { recursive: true });
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { home, cacheRoot };
}

function records(id, date, input, cached, output) {
  const timestamp = `${date}T03:00:00Z`;
  const usage = { input_tokens: input, cached_input_tokens: cached,
    output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output };
  return [
    { type: 'session_meta', timestamp, payload: { id, source: 'cli', cwd: 'F:/fixture' } },
    { type: 'turn_context', timestamp, payload: { model: 'gpt-5.5', service_tier: 'default',
      developer_instructions: 'Conversation text does not belong in usage input' } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count',
      info: { total_token_usage: usage, last_token_usage: usage } } }
  ].map(record => JSON.stringify(record)).join('\n') + '\n';
}

async function report(input, speed = 'standard') {
  const result = await promisify(execFile)(process.execPath,
    [cli, 'codex', 'daily', '--json', '--offline', '--speed', speed, '--timezone', 'UTC'],
    { env: { ...process.env, CODEX_HOME: input.home }, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(result.stdout);
}

test('real ccusage reviewer fallback is restored to its raw ID without hiding genuine GPT-5.5', async t => {
  const { home, cacheRoot } = fixture(t);
  fs.writeFileSync(path.join(home, 'sessions', 'main.jsonl'), records('main', '2026-10-28', 1000, 200, 100));
  fs.writeFileSync(path.join(home, 'sessions', 'guardian.jsonl'),
    records('guardian', '2026-10-28', 500, 300, 20).replace('"gpt-5.5"', '"codex-auto-review"'));
  const input = await prepareCodexInput({ home, cacheRoot });
  const selected = require('../lib/codex-loader').selectUsageSources(await report(input), true);
  const data = await enrichCodexUsage(selected, { roots: input.roots });
  const day = data.daily.find(row => row.date === '2026-10-28');
  const review = day.modelBreakdowns.find(row => row.modelName === 'codex-auto-review');
  assert.ok(review, JSON.stringify(day));
  assert.equal(review.inputTokens, 200);
  assert.equal(review.cacheReadTokens, 300);
  assert.equal(review.outputTokens, 20);
  assert.equal(review.unpriced, false);
  assert.equal(review.cost, 0.00063);
  const main = day.modelBreakdowns.find(row => row.modelName === 'gpt-5.5');
  assert.equal(main.inputTokens, 800);
  assert.equal(main.cacheReadTokens, 200);
  assert.equal(day.totalTokens, 1620);
});

test('real ccusage totals and quota history both include active and compressed historical logs', { skip: !supportsZstd }, async t => {
  const options = fixture(t);
  const archived = records('00000000-0000-0000-0000-000000000001', '2026-06-22', 2000, 1000, 100);
  const active = records('00000000-0000-0000-0000-000000000002', '2026-10-14', 4000, 3000, 200);
  fs.writeFileSync(path.join(options.home, 'archived_sessions', 'archive.jsonl.zst'), zlib.zstdCompressSync(Buffer.from(archived)));
  fs.writeFileSync(path.join(options.home, 'sessions', 'active.jsonl'), active);
  const input = await prepareCodexInput(options);
  assert.equal(input.fileCount, 2);
  assert.equal(input.compressedFileCount, 1);
  const raw = await report(input);
  assert.deepEqual(raw.daily.map(day => day.date), ['2026-06-22', '2026-10-14']);
  assert.equal(raw.totals.totalTokens, 6300);
  assert.equal(raw.totals.cacheReadTokens, 4000);
  assert.equal(raw.totals.inputTokens, 2000);
  assert.equal(raw.totals.outputTokens, 300);
  assert.ok(Math.abs(raw.totals.costUSD - 0.021) < 1e-10);
  const enriched = await enrichCodexUsage({ daily: [] }, { roots: input.roots });
  assert.equal(enriched.codexQuota.daily.length, 2);
  assert.ok(Math.abs(enriched.codexQuota.daily.reduce((sum, day) => sum + day.apiEquivalentUSD, 0) - 0.021) < 1e-10);
  const repeated = await prepareCodexInput(options);
  assert.equal(repeated.signature, input.signature);
  assert.equal(repeated.changedFiles, 0);
  assert.equal(repeated.reusedFiles, 2);
  assert.deepEqual((await report(repeated)).totals, raw.totals);
  // A second copy must not inflate the native report's cumulative totals.
  fs.writeFileSync(path.join(options.home, 'sessions', 'archive-copy.jsonl'), archived);
  assert.deepEqual((await report(await prepareCodexInput(options))).totals, raw.totals);
});

test('input cache notices file growth with a stale mtime and removes only derived obsolete files', async t => {
  const options = fixture(t);
  const filename = path.join(options.home, 'sessions', 'active.jsonl');
  fs.writeFileSync(filename, records('00000000-0000-0000-0000-000000000003', '2026-10-14', 2000, 1000, 100));
  const mtime = fs.statSync(filename).mtime;
  let input = await prepareCodexInput(options);
  assert.equal((await report(input)).totals.totalTokens, 2100);
  const appended = JSON.parse(records('unused', '2026-10-14', 4000, 2000, 200).trim().split('\n').at(-1));
  appended.payload.info.last_token_usage = { input_tokens: 2000, cached_input_tokens: 1000,
    output_tokens: 100, reasoning_output_tokens: 0, total_tokens: 2100 };
  appended.timestamp = '2026-10-14T03:01:00Z';
  fs.appendFileSync(filename, JSON.stringify(appended) + '\n');
  fs.utimesSync(filename, mtime, mtime);
  input = await prepareCodexInput(options);
  assert.equal((await report(input)).totals.totalTokens, 4200);
  const saved = JSON.parse(fs.readFileSync(path.join(input.home, 'manifest.json')));
  const output = Object.values(saved.files)[0].outputPath;
  const original = fs.readFileSync(filename, 'utf8');
  assert.ok(!fs.readFileSync(output, 'utf8').includes('Conversation text'));
  assert.ok(original.includes('Conversation text'));
  fs.unlinkSync(filename);
  await prepareCodexInput(options);
  assert.equal(fs.existsSync(output), false);
});

test('input preserves recorded thread speed changes so historical prices stay unchanged', async t => {
  const options = fixture(t);
  const lines = records('00000000-0000-0000-0000-000000000005', '2026-07-14', 2000, 1000, 100).trim().split('\n');
  const context = JSON.parse(lines[1]);
  context.payload.model = 'gpt-5.6-sol';
  lines[1] = JSON.stringify(context);
  const request = JSON.parse(lines[2]);
  request.timestamp = '2026-07-14T03:00:02Z';
  lines[2] = JSON.stringify(request);
  lines.splice(2, 0, JSON.stringify({ type: 'event_msg', timestamp: '2026-07-14T03:00:01Z',
    payload: { type: 'thread_settings_applied', thread_settings: { service_tier: 'priority' } } }));
  fs.writeFileSync(path.join(options.home, 'sessions', 'priority.jsonl'), lines.join('\n') + '\n');
  const input = await prepareCodexInput(options);
  const standard = await report(input);
  const auto = await report(input, 'auto');
  assert.equal(auto.totals.totalTokens, standard.totals.totalTokens);
  assert.ok(Math.abs(auto.totals.costUSD - standard.totals.costUSD * 2) < 1e-10,
    JSON.stringify({ auto: auto.totals.costUSD, standard: standard.totals.costUSD }));
});

test('an unreadable archive rejects the rebuild and leaves the previous input manifest intact', { skip: !supportsZstd }, async t => {
  const options = fixture(t);
  fs.writeFileSync(path.join(options.home, 'sessions', 'active.jsonl'),
    records('00000000-0000-0000-0000-000000000004', '2026-10-14', 2000, 1000, 100));
  const input = await prepareCodexInput(options);
  const manifestPath = path.join(input.home, 'manifest.json');
  const before = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(path.join(options.home, 'archived_sessions', 'broken.jsonl.zst'), 'not a zstd archive');
  await assert.rejects(prepareCodexInput(options));
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), before);
  assert.equal((await report(input)).totals.totalTokens, 2100);
});

test('Codex projection distinguishes malformed completed usage rows from an incomplete live tail', async t => {
  const options = fixture(t);
  const filename = path.join(options.home, 'sessions', 'active.jsonl');
  fs.writeFileSync(filename, records('00000000-0000-0000-0000-000000000006', '2026-10-14', 2000, 1000, 100)
    + '{"type":"token_count",broken}\n' + '{"type":"token_count",');
  const input = await prepareCodexInput(options);
  assert.equal(input.parseErrors, 1);
  assert.equal(input.pendingLines, 1);
  const repeated = await prepareCodexInput(options);
  assert.equal(repeated.parseErrors, 1);
  assert.equal(repeated.pendingLines, 1);
  fs.writeFileSync(filename, records('00000000-0000-0000-0000-000000000006', '2026-10-14', 2000, 1000, 100));
  const recovered = await prepareCodexInput(options);
  assert.equal(recovered.parseErrors, 0);
  assert.equal(recovered.pendingLines, 0);
});
