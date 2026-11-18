'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { readAccountRateLimits, normalizeAccountQuota, createAccountQuotaMonitor } = require('../lib/codex-account-quota');
const { buildQuotaHistory } = require('../lib/codex-quota-history');
const time = (hour, minute = 0) => new Date(2026, 9, 29, hour, minute).getTime();
const result = (used = 86, reset = time(20)) => ({ rateLimits: { limitId: 'codex', planType: 'plus',
  primary: { usedPercent: used, resetsAt: reset / 1000, windowDurationMins: 300 } } });

test('account quota selects only the Codex five-hour bucket, including a secondary bucket', () => {
  assert.equal(normalizeAccountQuota(result(), time(16)).usedPercent, 86);
  const multi = { rateLimits: result(80).rateLimits,
    rateLimitsByLimitId: { codex: { ...result(20).rateLimits,
      primary: { usedPercent: 90, windowDurationMins: 10080, resetsAt: time(20) / 1000 },
      secondary: result(20).rateLimits.primary } } };
  assert.equal(normalizeAccountQuota(multi, time(16)).usedPercent, 20);
  for (const value of [{}, { rateLimits: { limitId: 'other', primary: result().rateLimits.primary } },
    { rateLimits: { primary: { ...result().rateLimits.primary, windowDurationMins: 10080 } } },
    { rateLimits: { primary: { ...result().rateLimits.primary, usedPercent: -1 } } }]) {
    assert.equal(normalizeAccountQuota(value), null);
  }
});

function fakeChild(handler) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin.on('data', buffer => handler(JSON.parse(buffer.toString()), child));
  return child;
}

test('RPC reads quota after initialization without starting a model turn, then closes its child', async () => {
  const methods = [];
  const child = fakeChild((row, process) => {
    methods.push(row.method);
    if (row.id) setImmediate(() => process.stdout.write(JSON.stringify({ id: row.id, result: row.id === 2 ? result() : {} }) + '\n'));
  });
  const quota = await readAccountRateLimits({ command: ['native-codex'], spawnProcess: (command, args, options) => {
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio[2], 'ignore');
    assert.equal(args[0], 'app-server');
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    return child;
  } });
  assert.equal(quota.rateLimits.primary.usedPercent, 86);
  assert.deepEqual(methods, ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(child.killed, true);
  assert.equal(child.stdin.destroyed, true);
});

test('RPC timeout and cancellation close the quota reader', async () => {
  const child = fakeChild(() => {});
  await assert.rejects(readAccountRateLimits({ command: ['fake'], spawnProcess: () => child, timeoutMs: 10 }), /timed out/);
  assert.equal(child.killed, true);
  const cancelled = fakeChild(() => {}), controller = new AbortController();
  const work = readAccountRateLimits({ command: ['fake'], spawnProcess: () => cancelled, signal: controller.signal });
  controller.abort();
  await assert.rejects(work, /stopped/);
  assert.equal(cancelled.killed, true);
});

test('forced refresh persists new snapshots once, survives restart and keeps history on read failure', async () => {
  const filename = path.join(process.env.HOME, 'quota-capture', 'history.jsonl');
  let now = time(16), used = 86, calls = 0, failed = false;
  const monitor = createAccountQuotaMonitor({ filename, enabled: () => true, now: () => now,
    read: async () => { calls++; if (failed) throw new Error('private server diagnostic'); return result(used); } });
  await Promise.all([monitor.capture(true), monitor.capture(true)]);
  assert.equal(calls, 1);
  await monitor.capture();
  assert.equal(calls, 1);
  now += 1000; used = 100;
  await monitor.capture(true);
  assert.deepEqual(monitor.getSnapshots().map(row => row.usedPercent), [86, 100]);
  assert.equal(createAccountQuotaMonitor({ filename }).getSnapshots().length, 2);
  failed = true;
  await monitor.capture(true);
  assert.equal(monitor.getSnapshots().length, 2);
  assert.equal(monitor.getDiagnostics().stale, true);
  assert.ok(!JSON.stringify(monitor.getDiagnostics()).includes('private'));
  fs.appendFileSync(filename, '{partial');
  const original = fs.readFileSync(filename, 'utf8');
  failed = false;
  await monitor.capture(true);
  assert.equal(fs.readFileSync(filename, 'utf8'), original);
  assert.equal(monitor.getSnapshots().length, 2);
  assert.equal(monitor.getDiagnostics().stale, true);
});

test('user-confirmed history is durable, idempotent and distinguished from a measured exhaustion time', () => {
  const filename = path.join(process.env.HOME, 'quota-confirmation', 'history.jsonl');
  const monitor = createAccountQuotaMonitor({ filename, now: () => time(23) });
  const confirmation = { resetsAt: time(20), usedPercent: 100, note: 'User confirmed this window was exhausted' };
  monitor.confirmWindow(confirmation); monitor.confirmWindow(confirmation);
  const saved = createAccountQuotaMonitor({ filename }).getSnapshots();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].observedAt, null);
  assert.equal(saved[0].confirmedAt, new Date(time(23)).toISOString());
  const history = buildQuotaHistory([{ timestamp: time(16), cost: 1, quotaReset: time(20), speedKnown: true }],
    [normalizeAccountQuota(result(0), time(15)), normalizeAccountQuota(result(), time(16)), ...saved]);
  assert.equal(history.daily[0].usedPercent, 100);
  assert.equal(history.daily[0].windows[0].completionSource, 'user-confirmed');
  assert.equal(history.daily[0].windows[0].reached100At, null);
  assert.equal(history.completedWindows.length, 1);
  assert.equal(history.daily[0].windows[0].estimateBasis, 'confirmed100');
  assert.equal(history.daily[0].windows[0].estimatedPer100USD, 1);
});
