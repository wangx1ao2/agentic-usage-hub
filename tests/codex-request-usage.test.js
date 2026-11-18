const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecords, applyRequestPricing, priceRequest, enrichCodexUsage } = require('../lib/codex-request-usage');
const { getCcusageBreakdownCost } = require('../unified-server');

const usage = (input, cached, output) => ({ input_tokens: input, cached_input_tokens: cached,
  output_tokens: output, reasoning_output_tokens: Math.floor(output / 2), total_tokens: input + output });
const quota = (used, reset) => ({ limit_id: 'codex', primary: {
  used_percent: used, resets_at: reset, window_minutes: 300 }, plan_type: 'plus' });
const token = (time, total, last, limits) => ({ type: 'event_msg', timestamp: time,
  payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last }, rate_limits: limits } });
const context = { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } };

test('long-context pricing uses each request input and includes reasoning only once', () => {
  assert.equal(priceRequest('gpt-6.1-sol', usage(272_000, 200_000, 10_000)).cost, 0.264);
  const long = priceRequest('gpt-6.1-sol', usage(272_001, 200_000, 10_000));
  assert.ok(Math.abs(long.cost - 0.478004) < 1e-9);
  assert.equal(long.longContext, true);
  assert.equal(long.speedKnown, false);
  assert.ok(Math.abs(priceRequest('gpt-6.1-sol', usage(272_001, 200_000, 10_000), 'priority').cost - 0.956008) < 1e-9);
});

test('Terra request pricing applies the long-context threshold and fast multiplier', () => {
  assert.equal(priceRequest('gpt-6.1-terra', usage(272_000, 200_000, 10_000)).cost, 0.132);
  const long = priceRequest('gpt-6.1-terra', usage(272_001, 200_000, 10_000), 'fast');
  assert.equal(long.longContext, true);
  assert.ok(Math.abs(long.cost - 0.478004) < 1e-9);
  assert.equal(getCcusageBreakdownCost('gpt-6.1-terra', { inputTokens: 72_000, cacheReadTokens: 200_000, outputTokens: 10_000 }).cost, 0.132);
});

test('forked totals and repeated quota updates do not add requests', () => {
  const reset = Date.parse('2026-10-11T07:01:17Z') / 1000;
  const last = usage(300_000, 280_000, 10_000);
  const inherited = usage(2_000_000, 1_500_000, 50_000);
  const result = parseRecords([context,
    token('2026-10-11T02:05:00Z', inherited, last, quota(10, reset)),
    token('2026-10-11T03:26:36Z', inherited, last, quota(100, reset))]);
  assert.equal(result.events.length, 1);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.events[0].inputTokens, 20_000);
  assert.equal(result.events[0].cacheReadTokens, 280_000);
  assert.ok(Math.abs(result.events[0].cost - 0.286) < 1e-9);
});

test('a matching ccusage snapshot receives request pricing without pricing the aggregate as one request', () => {
  const first = usage(200_000, 100_000, 10_000);
  const total = usage(400_000, 200_000, 20_000);
  const parsed = parseRecords([context,
    token('2026-10-11T02:05:00Z', first, first),
    token('2026-10-11T02:06:00Z', total, first)]);
  const breakdown = { modelName: 'gpt-6.1-sol', agent: 'codex', inputTokens: 200_000,
    cacheReadTokens: 200_000, outputTokens: 20_000, cost: 0 };
  const data = { daily: [{ date: parsed.events[0].date, modelBreakdowns: [breakdown] }] };
  applyRequestPricing(data, [parsed, parsed]); // Duplicate files should also be ignored.
  assert.equal(breakdown.requestPricing.longContextRequests, 0);
  assert.equal(breakdown.requestPricing.cost, 0.62);
  assert.equal(getCcusageBreakdownCost(breakdown.modelName, breakdown).cost, 0.62);
  const prefix = { ...breakdown, inputTokens: 100_000, cacheReadTokens: 100_000, outputTokens: 10_000 };
  applyRequestPricing({ daily: [{ date: parsed.events[0].date, modelBreakdowns: [prefix] }] }, [parsed]);
  assert.equal(prefix.requestPricing.cost, 0.31);
  breakdown.inputTokens += 1;
  applyRequestPricing(data, [parsed]);
  assert.equal(breakdown.requestPricing, undefined);
});

test('file enrichment ignores an incomplete live tail and refreshes modified files', async (t) => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-hub-request-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const filename = path.join(root, 'session.jsonl');
  const one = usage(300_000, 280_000, 10_000);
  const initial = [context, token('2026-10-11T02:05:00Z', one, one)];
  fs.writeFileSync(filename, initial.map(record => JSON.stringify(record)).join('\n') + '\n{"type":');
  fs.utimesSync(filename, new Date('2026-10-11T12:00:00Z'), new Date('2026-10-11T12:00:00Z'));
  const breakdown = { modelName: 'gpt-6.1-sol', agent: 'codex', inputTokens: 20_000,
    cacheReadTokens: 280_000, outputTokens: 10_000, cost: 0 };
  const date = new Date('2026-10-11T02:05:00Z');
  const day = require('../lib/date').getLocalDateStr(date);
  const data = { daily: [{ date: day, modelBreakdowns: [breakdown] }] };
  await enrichCodexUsage(data, { roots: [root] });
  assert.equal(breakdown.requestPricing.cost, 0.286);
  const second = token('2026-10-11T02:06:00Z', usage(600_000, 560_000, 20_000), one);
  fs.writeFileSync(filename, [...initial, second].map(record => JSON.stringify(record)).join('\n'));
  fs.utimesSync(filename, new Date('2026-10-11T12:01:00Z'), new Date('2026-10-11T12:01:00Z'));
  breakdown.inputTokens *= 2; breakdown.cacheReadTokens *= 2; breakdown.outputTokens *= 2;
  await enrichCodexUsage(data, { roots: [root] });
  assert.equal(breakdown.requestPricing.cost, 0.572);
  assert.equal(breakdown.requestPricing.longContextRequests, 2);
});

test('overlapping reset windows keep request costs with their observed quota window', () => {
  const original = Date.parse('2026-10-11T07:01:17Z') / 1000;
  const manualReset = Date.parse('2026-10-11T09:18:35Z') / 1000;
  const one = usage(200_000, 100_000, 10_000);
  const two = usage(400_000, 200_000, 20_000);
  const parsed = parseRecords([context,
    token('2026-10-11T03:26:36Z', one, one, quota(100, original)),
    token('2026-10-11T04:18:36Z', two, one, quota(0, manualReset))]);
  const data = applyRequestPricing({ daily: [] }, [parsed]);
  assert.equal(data.codexQuota.latest.usedPercent, 0);
  assert.equal(data.codexQuota.completedWindows.length, 1);
  assert.equal(data.codexQuota.completedWindows[0].apiEquivalentAt100, 0.31);
});

test('older Codex logs without limit_id still expose their five-hour quota', () => {
  const reset = Date.parse('2026-10-11T07:01:17Z') / 1000;
  const limits = quota(50, reset);
  delete limits.limit_id;
  const one = usage(200_000, 100_000, 10_000);
  const parsed = parseRecords([context, token('2026-10-11T02:05:00Z', one, one, limits)]);
  assert.equal(parsed.snapshots[0].usedPercent, 50);
  const weekly = { ...limits, primary: { ...limits.primary, window_minutes: 10080 } };
  assert.equal(parseRecords([context, token('2026-10-11T02:06:00Z', one, one, weekly)]).snapshots.length, 0);
});

test('recorded thread speed settings persist across turns and can explicitly return to standard', () => {
  const one = usage(200_000, 100_000, 10_000);
  const settings = service_tier => ({ type: 'event_msg', payload: {
    type: 'thread_settings_applied', thread_settings: { service_tier } } });
  const parsed = parseRecords([context, settings('priority'), context,
    token('2026-10-11T02:05:00Z', one, one), context,
    token('2026-10-11T02:06:00Z', usage(400_000, 200_000, 20_000), one),
    settings(null), context,
    token('2026-10-11T02:07:00Z', usage(600_000, 300_000, 30_000), one)]);
  assert.deepEqual(parsed.events.map(event => event.cost), [0.62, 0.62, 0.31]);
  assert.ok(parsed.events.every(event => event.speedKnown));
});

test('quota rebuild includes compressed archives and deduplicates an uncompressed copy', {
  skip: typeof require('zlib').createZstdDecompress !== 'function'
}, async t => {
  const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-hub-quota-archive-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const reset = Date.parse('2026-10-11T07:00:00Z') / 1000;
  const one = usage(200_000, 100_000, 10_000);
  const records = [{ type: 'session_meta', payload: { id: 'archived-quota-session' } }, context,
    token('2026-10-11T02:00:00Z', null, null, quota(0, reset)),
    token('2026-10-11T03:00:00Z', one, one, quota(80, reset))];
  const contents = records.map(record => JSON.stringify(record)).join('\n');
  fs.writeFileSync(path.join(root, 'archive.jsonl.zst'), zlib.zstdCompressSync(Buffer.from(contents)));
  fs.writeFileSync(path.join(root, 'corrupt.jsonl.zst'), 'unreadable archive');
  const data = await enrichCodexUsage({ daily: [] }, { roots: [root] });
  assert.equal(data.codexQuota.windows.length, 1);
  assert.equal(data.codexQuota.daily[0].usedPercent, 80);
  assert.equal(data.codexQuota.daily[0].apiEquivalentUSD, 0.31);
  fs.writeFileSync(path.join(root, 'copy.jsonl'), contents);
  await enrichCodexUsage(data, { roots: [root] });
  assert.equal(data.codexQuota.daily[0].usedPercent, 80);
  assert.equal(data.codexQuota.daily[0].apiEquivalentUSD, 0.31);
});
