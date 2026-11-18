const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLiveMonitor, summarizeUsage } = require('../lib/codex-live-usage');

const usage = (input, cache, output) => ({ input_tokens: input, cached_input_tokens: cache,
  output_tokens: output, reasoning_output_tokens: output / 2, total_tokens: input + output });
const token = (now, total, last = total) => ({ type: 'event_msg', timestamp: new Date(now).toISOString(),
  payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } });
const meta = id => ({ type: 'session_meta', payload: { id, cwd: 'F:/工程/测试' } });
const context = { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } };
const lines = records => records.map(JSON.stringify).join('\n') + '\n';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-live-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('window rate sums parallel sessions without counting cache or reasoning twice', () => {
  const now = Date.now();
  const event = (id, age, fresh, cache, output) => ({ key: id + age, sessionId: id, cwd: '/project',
    model: 'gpt-6.1-sol', timestamp: now - age, inputTokens: fresh, cacheReadTokens: cache, outputTokens: output });
  const a = event('a', 1000, 600, 2400, 120);
  const result = summarizeUsage([a, a, event('b', 3000, 120, 600, 60),
    event('idle', 60_000, 1000, 0, 100), event('expired', 300_000, 1, 0, 1),
    event('future', -1000, 1, 0, 1), event('zero', 0, 0, 0, 0),
    event('invalid', 0, 1, -1, 1)], now);
  assert.equal(result.activeSessionCount, 2);
  assert.equal(result.totals.tokensPerSecond, 65);
  assert.equal(result.totals.inputTokensPerSecond, 12);
  assert.equal(result.totals.cacheReadTokensPerSecond, 50);
  assert.equal(result.totals.outputTokensPerSecond, 3);
  assert.equal(result.totals.requests, 2);
  assert.equal(result.sessions.length, 3);
  assert.equal(result.sessions.find(row => row.sessionId === 'b').totalTokens, 780);
  assert.equal(result.sessions.find(row => row.sessionId === 'idle').tokensPerSecond, 0);
});

test('incremental reads deduplicate quota updates, handle incomplete appends and preserve model context', async t => {
  const root = fixture(t), filename = path.join(root, 'live.jsonl');
  let now = Date.now();
  const monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0, discoveryMs: 0 });
  const first = token(now - 1000, usage(3000, 2400, 120));
  fs.writeFileSync(filename, lines([meta('chat-a'), context, first]));
  let data = await monitor.getSnapshot();
  assert.equal(data.totals.totalTokens, 3120);
  assert.equal(data.sessions[0].cwd, 'F:/工程/测试');
  assert.equal(data.totals.requests, 1);
  fs.appendFileSync(filename, lines([{ ...first, timestamp: new Date(now).toISOString() }]));
  data = await monitor.getSnapshot();
  assert.equal(data.totals.requests, 1);
  const second = JSON.stringify(token(now, usage(6000, 4800, 240), usage(3000, 2400, 120)));
  fs.appendFileSync(filename, second.slice(0, -8));
  data = await monitor.getSnapshot();
  assert.equal(data.totals.requests, 1);
  fs.appendFileSync(filename, second.slice(-8)); // no newline yet
  data = await monitor.getSnapshot();
  assert.equal(data.totals.requests, 2);
  assert.equal(data.totals.tokensPerSecond, 104);
  assert.equal(data.sessions[0].model, 'gpt-6.1-sol');
  assert.equal((await monitor.getSnapshot()).totals.requests, 2);
  now += 61_000;
  data = await monitor.getSnapshot();
  assert.equal(data.status, 'idle');
  assert.equal(data.totals.tokensPerSecond, 0);
  assert.equal(data.sessions.length, 1);
  now += 300_000;
  assert.equal((await monitor.getSnapshot()).sessions.length, 0);
});

test('forks use last request usage rather than inherited totals and duplicate files count once', async t => {
  const root = fixture(t), now = Date.now();
  const records = [meta('fork'), context,
    token(now, usage(900_000, 800_000, 40_000), usage(1200, 600, 60))];
  fs.writeFileSync(path.join(root, 'a.jsonl'), lines(records));
  fs.writeFileSync(path.join(root, 'b.jsonl'), lines(records));
  const data = await createLiveMonitor({ roots: [root], now: () => now }).getSnapshot();
  assert.equal(data.totals.totalTokens, 1260);
  assert.equal(data.totals.tokensPerSecond, 21);
  assert.equal(data.activeSessionCount, 1);
});

test('old date directories are rediscovered when a chat resumes; removed and truncated files recover', async t => {
  const root = fixture(t), nested = path.join(root, '2025', '01', '01');
  fs.mkdirSync(nested, { recursive: true });
  const filename = path.join(nested, 'resumed.jsonl');
  let now = Date.now();
  fs.writeFileSync(filename, lines([meta('old'), context, token(now - 600_000, usage(3000, 0, 120))]));
  fs.utimesSync(filename, new Date(now - 600_000), new Date(now - 600_000));
  const monitor = createLiveMonitor({ roots: [root], now: () => now, discoveryMs: 0, pollMs: 0 });
  assert.equal((await monitor.getSnapshot()).sessions.length, 0);
  fs.appendFileSync(filename, lines([token(now, usage(6000, 0, 240), usage(3000, 0, 120))]));
  fs.utimesSync(filename, new Date(now), new Date(now));
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 3120);
  fs.writeFileSync(filename, lines([meta('replacement'), context, token(now, usage(60, 0, 6))]));
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 66);
  fs.unlinkSync(filename);
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 0);
});

test('UTF-8 split across polls, oversized non-usage lines and concurrent clients do not corrupt counts', async t => {
  const root = fixture(t), filename = path.join(root, 'unicode.jsonl'), now = Date.now();
  const monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0, discoveryMs: 0 });
  const header = Buffer.from(lines([meta('unicode'), context]));
  const split = header.indexOf(Buffer.from('工程')) + 1;
  fs.writeFileSync(filename, header.subarray(0, split));
  assert.equal((await monitor.getSnapshot()).sessions.length, 0);
  fs.appendFileSync(filename, header.subarray(split));
  fs.appendFileSync(filename, lines([{ type: 'response_item', payload: { content: 'x'.repeat(1100000) } },
    token(now, usage(600, 0, 60))]));
  const snapshots = await Promise.all([monitor.getSnapshot(), monitor.getSnapshot(), monitor.getSnapshot()]);
  for (const data of snapshots) {
    assert.equal(data.totals.totalTokens, 660);
    assert.equal(data.sessions[0].cwd, 'F:/工程/测试');
  }
});

test('missing logs are unavailable rather than an apparently measured zero', async t => {
  const root = fixture(t);
  const data = await createLiveMonitor({ roots: [path.join(root, 'missing')] }).getSnapshot();
  assert.equal(data.sourceAvailable, false);
  assert.equal(data.status, 'unavailable');
  const empty = await createLiveMonitor({ roots: [root] }).getSnapshot();
  assert.equal(empty.status, 'unavailable');
});

test('the rolling window expires even when a second client receives a cached disk snapshot', async t => {
  const root = fixture(t), filename = path.join(root, 'boundary.jsonl');
  let now = Date.now();
  fs.writeFileSync(filename, lines([meta('boundary'), context, token(now - 59_999, usage(600, 0, 60))]));
  const monitor = createLiveMonitor({ roots: [root], now: () => now });
  assert.equal((await monitor.getSnapshot()).status, 'active');
  now += 2;
  const expired = await monitor.getSnapshot();
  assert.equal(expired.status, 'idle');
  assert.equal(expired.activeSessionCount, 0);
  assert.equal(expired.totals.tokensPerSecond, 0);
});

test('live parsers retain recent keys only, including a baseline that prevents stale quota updates becoming usage', async t => {
  const root = fixture(t), filename = path.join(root, 'long-history.jsonl');
  let now = Date.now();
  const history = Array.from({ length: 3000 }, (_, index) => token(now - 600_000 + index,
    usage((index + 1) * 600, 0, (index + 1) * 60), usage(600, 0, 60)));
  fs.writeFileSync(filename, lines([meta('long'), context, ...history]));
  const monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0 });
  t.after(() => monitor.dispose());
  assert.equal((await monitor.getSnapshot()).totals.requests, 0);
  assert.equal(monitor.getDiagnostics().retainedKeys, 0);
  fs.appendFileSync(filename, lines([{ ...history.at(-1), timestamp: new Date(now).toISOString() }]));
  assert.equal((await monitor.getSnapshot()).totals.requests, 0);
  fs.appendFileSync(filename, lines([token(now, usage(1800600, 0, 180060), usage(600, 0, 60))]));
  assert.equal((await monitor.getSnapshot()).totals.requests, 1);
  assert.equal(monitor.getDiagnostics().retainedKeys, 1);
  now += 301_000;
  await monitor.getSnapshot();
  assert.equal(monitor.getDiagnostics().retainedKeys, 0);
});

test('no clients releases live caches and a later request rebuilds the same recent usage', async t => {
  const root = fixture(t), filename = path.join(root, 'idle-release.jsonl'), now = Date.now();
  fs.writeFileSync(filename, lines([meta('release'), context, token(now, usage(600, 0, 60))]));
  const monitor = createLiveMonitor({ roots: [root], now: () => now, idleReleaseMs: 30 });
  t.after(() => monitor.dispose());
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 660);
  assert.equal(monitor.getDiagnostics().trackedFiles, 1);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(monitor.getDiagnostics(), { trackedFiles: 0, retainedEvents: 0, retainedKeys: 0, pendingCharacters: 0 });
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 660);
});

test('cold discovery reads recent log timestamps when an open Windows writer leaves mtime stale', async t => {
  const root = fixture(t), filename = path.join(root, 'stale-mtime.jsonl'), now = Date.now();
  fs.writeFileSync(filename, lines([meta('windows-live'), context, token(now, usage(1200, 600, 60))]));
  const oldTime = new Date(now - 3_600_000);
  fs.utimesSync(filename, oldTime, oldTime);
  const monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0 });
  t.after(() => monitor.dispose());
  const data = await monitor.getSnapshot();
  assert.equal(data.status, 'active');
  assert.equal(data.activeSessionCount, 1);
  assert.equal(data.totals.totalTokens, 1260);
  assert.equal(data.totals.tokensPerSecond, 21);
});

test('file size growth discovers a resumed old chat even when its mtime never changes', async t => {
  const root = fixture(t), filename = path.join(root, 'resumed-stale-mtime.jsonl');
  let now = Date.now();
  const oldTime = new Date(now - 3_600_000);
  fs.writeFileSync(filename, lines([meta('windows-resume'), context, token(now - 3_600_000, usage(600, 0, 60))]));
  fs.utimesSync(filename, oldTime, oldTime);
  const monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0, discoveryMs: 0 });
  t.after(() => monitor.dispose());
  assert.equal((await monitor.getSnapshot()).totals.requests, 0);
  now += 1000;
  fs.appendFileSync(filename, lines([token(now, usage(1200, 0, 120), usage(600, 0, 60))]));
  fs.utimesSync(filename, oldTime, oldTime);
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 660);
  fs.appendFileSync(filename, lines([token(now, usage(1800, 0, 180), usage(600, 0, 60))]));
  fs.utimesSync(filename, oldTime, oldTime);
  assert.equal((await monitor.getSnapshot()).totals.totalTokens, 1320);
});

test('a stale-mtime writer doing tool work keeps its read cursor without inventing token usage', async t => {
  const root = fixture(t), filename = path.join(root, 'tool-work.jsonl');
  let now = Date.now();
  const oldTime = new Date(now - 3_600_000);
  const activity = () => ({ type: 'event_msg', timestamp: new Date(now).toISOString(), payload: { type: 'item_completed' } });
  fs.writeFileSync(filename, lines([meta('tool-work'), context, token(now - 3_600_000, usage(600, 0, 60)), activity()]));
  fs.utimesSync(filename, oldTime, oldTime);
  const monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0, discoveryMs: 0 });
  t.after(() => monitor.dispose());
  assert.equal((await monitor.getSnapshot()).totals.requests, 0);
  assert.equal(monitor.getDiagnostics().trackedFiles, 1);
  now += 10_000;
  fs.appendFileSync(filename, lines([activity()]));
  fs.utimesSync(filename, oldTime, oldTime);
  assert.equal((await monitor.getSnapshot()).totals.requests, 0);
  assert.equal(monitor.getDiagnostics().trackedFiles, 1);
  now += 301_000;
  await monitor.getSnapshot();
  assert.equal(monitor.getDiagnostics().trackedFiles, 0);
});
