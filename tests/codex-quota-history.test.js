const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQuotaHistory } = require('../lib/codex-quota-history');
const { toDateStr } = require('../lib/date');

const time = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const snapshot = (timestamp, usedPercent, resetsAt) => ({ timestamp,
  observedAt: new Date(timestamp).toISOString(), usedPercent, resetsAt, windowMinutes: 300 });
const event = (timestamp, quotaReset, cost) => ({ timestamp, date: toDateStr(timestamp),
  quotaReset, cost, unpriced: false, speedKnown: true });

test('daily quota counts full and partial windows, while estimates exclude post-100 continuation', () => {
  const a = time(11, 9, 59), b = time(11, 15, 1), c = time(11, 17, 18), d = time(11, 23, 9);
  const q = [snapshot(time(11, 9, 38), 9, a), snapshot(time(11, 9, 50), 17, a),
    snapshot(time(11, 10, 1), 0, b), snapshot(time(11, 10, 30), 50, b), snapshot(time(11, 11, 26), 100, b),
    snapshot(time(11, 12, 18), 0, c), snapshot(time(11, 14, 40), 100, c),
    snapshot(time(11, 18, 9), 0, d), snapshot(time(11, 19, 31), 51, d)];
  const e = [event(time(11, 9, 38), a, 1), event(time(11, 9, 50), a, 0.8),
    event(time(11, 10, 30), b, 5), event(time(11, 11, 26), b, 5), event(time(11, 11, 30), b, 2),
    event(time(11, 14, 40), c, 8), event(time(11, 19, 31), d, 5.1)];
  const result = buildQuotaHistory(e, q);
  const day = result.daily[0];
  assert.equal(day.usedPercent, 268);
  assert.equal(day.quotaUnits, 2.68);
  assert.equal(day.completedWindowCount, 2);
  assert.equal(day.apiEquivalentUSD, 26.9);
  assert.equal(day.comparableUsedPercent, 259);
  assert.equal(day.averagePer100USD, 9.227799);
  assert.equal(day.windows[0].estimatedPer100USD, 10); // Use the recorded 8% increase, not all 17%.
  assert.equal(day.windows[1].apiEquivalentUSD, 12);
  assert.equal(day.windows[1].estimatedPer100USD, 10); // Exclude the $2 continuation.
  assert.equal(day.windows[2].estimatedPer100USD, 8); // Explicit reset avoids overlapping timestamps.
  assert.equal(day.windows[3].estimatedPer100USD, 10);
  assert.equal(result.completedWindows.length, 2);
  assert.equal(day.windows[1].displayEndsAt, day.windows[2].startsAt);
  assert.equal(day.windows[1].resetsAt, b); // Keep the original scheduled reset.
  assert.ok(day.windows.every((row, i, rows) => !i || rows[i - 1].displayEndsAt <= row.startsAt));
});

test('duplicate snapshots, small reset jitter and stale counter decreases do not increase totals', () => {
  const reset = time(11, 15);
  const q = [snapshot(time(11, 10), 0, reset), snapshot(time(11, 10, 30), 50, reset + 10_000),
    snapshot(time(11, 10, 31), 48, reset), snapshot(time(11, 10, 35), 60, reset)];
  const result = buildQuotaHistory([event(time(11, 10, 35), reset + 10_000, 6)], [...q, ...q]);
  assert.equal(result.windows.length, 1);
  assert.equal(result.daily[0].usedPercent, 60);
  assert.equal(result.daily[0].averagePer100USD, 10);
});

test('a window crossing midnight assigns only the new quota percentage to each day', () => {
  const reset = time(11, 3);
  const q = [snapshot(time(10, 22), 0, reset), snapshot(time(10, 23, 55), 40, reset),
    snapshot(time(11, 0, 20), 70, reset), snapshot(time(11, 1), 100, reset)];
  const e = [event(time(10, 23, 55), reset, 4), event(time(11, 0, 20), reset, 3), event(time(11, 1), reset, 3)];
  const result = buildQuotaHistory(e, q);
  assert.equal(result.daily[0].usedPercent, 40);
  assert.equal(result.daily[1].usedPercent, 60);
  assert.equal(result.daily[1].apiEquivalentUSD, 6);
  assert.equal(result.daily[1].averagePer100USD, 10);
  assert.equal(result.daily[1].windows[0].estimatedPer100USD, 10);
  assert.equal(result.daily[0].completedWindowCount, 0);
  assert.equal(result.daily[1].completedWindowCount, 1);
});

test('missing midnight baseline is marked as a lower bound and never treated as an observed full window', () => {
  const reset = time(11, 3);
  const q = [snapshot(time(11, 0, 20), 70, reset), snapshot(time(11, 1), 100, reset)];
  const e = [event(time(11, 0, 20), reset, 3), event(time(11, 1), reset, 3)];
  const result = buildQuotaHistory(e, q);
  assert.equal(result.daily[0].usedPercent, 30);
  assert.equal(result.daily[0].usageIsLowerBound, true);
  assert.equal(result.daily[0].windows[0].estimateBasis, 'linear-incomplete100');
  assert.equal(result.daily[0].windows[0].estimatedPer100USD, 10);
  assert.equal(result.completedWindows[0].apiEquivalentAt100, 6);
});

test('requests without quota snapshots show dollars and unknown quota, not zero quota', () => {
  const result = buildQuotaHistory([event(time(11, 10), null, 4)], []);
  assert.equal(result.daily[0].apiEquivalentUSD, 4);
  assert.equal(result.daily[0].unattributedApiEquivalentUSD, 4);
  assert.equal(result.daily[0].usedPercent, null);
  assert.equal(result.daily[0].averagePer100USD, null);
});

test('initialization snapshots with zero usage do not manufacture a 100-percent price', () => {
  const reset = time(11, 15);
  const result = buildQuotaHistory([], [snapshot(time(11, 10), 0, reset)]);
  assert.equal(result.daily[0].usedPercent, 0);
  assert.equal(result.daily[0].averagePer100USD, null);
  assert.equal(result.daily[0].windows.length, 0);
});

test('a counter sampled above 100 is normalized and later overrun does not dilute its estimate', () => {
  const reset = time(11, 15);
  const q = [snapshot(time(11, 10), 0, reset), snapshot(time(11, 11), 105, reset), snapshot(time(11, 11, 10), 120, reset)];
  const e = [event(time(11, 11), reset, 10.5), event(time(11, 11, 10), reset, 2)];
  const result = buildQuotaHistory(e, q);
  assert.equal(result.daily[0].usedPercent, 120);
  assert.equal(result.daily[0].averagePer100USD, 10);
  assert.equal(result.daily[0].windows[0].estimatedPer100USD, 10);
});

test('multi-minute reset drift and delayed parallel counters stay in one window', () => {
  const reset = time(14, 10);
  const drift = reset + 217_000;
  const q = [snapshot(time(14, 8, 36), 8, reset), snapshot(time(14, 8, 42), 8, drift),
    snapshot(time(14, 9, 11), 18, reset - 59_000), snapshot(time(14, 9, 25), 40, reset),
    snapshot(time(14, 9, 30), 26, drift), snapshot(time(14, 9, 57), 52, reset - 59_000)];
  const e = [event(time(14, 8, 36), reset, 0.8), event(time(14, 8, 42), drift, 0.2),
    event(time(14, 9, 25), reset, 3), event(time(14, 9, 30), drift, 1),
    event(time(14, 9, 57), reset - 59_000, 1.2)];
  const result = buildQuotaHistory(e, q);
  assert.equal(result.windows.length, 1);
  assert.equal(result.daily[0].windows.length, 1);
  assert.equal(result.daily[0].usedPercent, 52);
  assert.equal(result.daily[0].apiEquivalentUSD, 6.2);
  assert.equal(result.daily[0].quotaApiEquivalentUSD, 6.2);
});

test('a real early counter reset starts at its observation time and stays separate', () => {
  const reset = time(11, 15), nextReset = time(11, 15, 31);
  const q = [snapshot(time(11, 10), 0, reset), snapshot(time(11, 10, 30), 50, reset),
    snapshot(time(11, 10, 31), 0, nextReset), snapshot(time(11, 11), 20, nextReset)];
  const result = buildQuotaHistory([event(time(11, 10, 30), reset, 5),
    event(time(11, 11), nextReset, 2)], q);
  assert.equal(result.windows.length, 2);
  assert.equal(result.daily[0].usedPercent, 70);
  assert.equal(result.windows[0].displayEndsAt, result.windows[1].startsAt);
});

test('unused initialization windows do not shorten the displayed usage interval', () => {
  const reset = time(11, 15), unusedReset = time(11, 17);
  const result = buildQuotaHistory([event(time(11, 11), reset, 2)],
    [snapshot(time(11, 10), 0, reset), snapshot(time(11, 11), 20, reset),
      snapshot(time(11, 12), 0, unusedReset)]);
  assert.equal(result.daily[0].windows.length, 1);
  assert.equal(result.daily[0].windows[0].displayEndsAt, reset);
});

test('a delayed low counter with a four-minute reset drift cannot truncate a five-hour window', () => {
  const reset = time(14, 15), drift = reset + 4 * 60_000;
  const q = [snapshot(time(14, 10), 1, reset), snapshot(time(14, 10, 10), 20, reset),
    snapshot(time(14, 10, 20), 1, drift), snapshot(time(14, 11), 3, drift),
    snapshot(time(14, 12), 80, reset), snapshot(time(14, 13), 100, reset)];
  const e = [event(time(14, 10, 10), reset, 2), event(time(14, 11), drift, 0.3),
    event(time(14, 12), reset, 8)];
  const result = buildQuotaHistory(e, q);
  const day = result.daily[0];
  assert.equal(result.windows.length, 1);
  assert.equal(day.usedPercent, 100);
  assert.equal(day.completedWindowCount, 1);
  assert.equal(day.apiEquivalentUSD, 10.3);
  assert.equal(day.quotaApiEquivalentUSD, 10.3);
  assert.equal(day.windows[0].displayEndsAt - day.windows[0].startsAt, 5 * 60 * 60_000);
});

test('reset drift beyond five minutes merges into an active counter without merging its successor', () => {
  const reset = time(14, 15), drift = time(14, 15, 10), nextReset = time(14, 20);
  const q = [snapshot(time(14, 10), 0, reset), snapshot(time(14, 11), 20, reset),
    snapshot(time(14, 11, 15), 18, drift), snapshot(time(14, 14), 88, reset),
    snapshot(time(14, 14, 50), 87, drift), snapshot(time(14, 15), 0, nextReset),
    snapshot(time(14, 16), 30, nextReset)];
  const e = [event(time(14, 11), reset, 2), event(time(14, 11, 15), drift, 1),
    event(time(14, 16), nextReset, 3)];
  const result = buildQuotaHistory(e, q);
  assert.equal(result.windows.length, 2);
  assert.equal(result.daily[0].usedPercent, 118);
  assert.equal(result.daily[0].quotaApiEquivalentUSD, 6);
  for (const row of result.daily[0].windows) {
    assert.equal(row.displayEndsAt - row.startsAt, 5 * 60 * 60_000);
  }
});

test('a sliding initialization reset remains one window across repeated low-usage observations', () => {
  const reset = time(11, 2), drift = time(11, 3);
  const q = [snapshot(time(10, 21), 1, reset), snapshot(time(10, 21, 10), 1, reset + 10 * 60_000),
    snapshot(time(10, 21, 40), 1, reset + 40 * 60_000), snapshot(time(10, 22), 1, drift),
    snapshot(time(10, 22, 30), 4, drift)];
  const result = buildQuotaHistory([event(time(10, 22, 30), drift, 0.4)], q);
  assert.equal(result.windows.length, 1);
  assert.equal(result.daily[0].usedPercent, 4);
  assert.equal(result.daily[0].quotaApiEquivalentUSD, 0.4);
  assert.equal(result.windows[0].displayEndsAt - result.windows[0].startsAt, 5 * 60 * 60_000);
});

test('a scheduled rollover stays separate even when the previous counter barely increased', () => {
  const reset = time(14, 15), nextReset = time(14, 19, 59);
  const result = buildQuotaHistory([], [snapshot(time(14, 10), 1, reset),
    snapshot(time(14, 14, 59), 0, nextReset), snapshot(time(14, 16), 2, nextReset)]);
  assert.equal(result.windows.length, 2);
  assert.equal(result.daily[0].usedPercent, 3);
});

test('a parallel counter near its inferred start cannot end a counter that continues afterward', () => {
  const reset = time(14, 15), drift = time(14, 15, 4);
  const q = [snapshot(time(14, 10), 0, reset), snapshot(time(14, 10, 1), 20, reset + 5_000),
    snapshot(time(14, 10, 4), 1, drift), snapshot(time(14, 12), 80, reset + 5_000)];
  const result = buildQuotaHistory([], q);
  assert.equal(result.windows.length, 1);
  assert.equal(result.daily[0].usedPercent, 80);
  assert.equal(result.windows[0].displayEndsAt - result.windows[0].startsAt, 5 * 60 * 60_000);
});

test('ephemeral subscription API costs join the active window and its first-100 estimate', () => {
  const reset = time(29, 20);
  const q = [snapshot(time(29, 15), 0, reset), snapshot(time(29, 16), 86, reset),
    { ...snapshot(time(29, 17), 100, reset), source: 'account-rate-limits' }];
  const api = timestamp => ({ ...event(timestamp, null, 2), source: 'api',
    pricingContext: { billingMode: 'chatgpt-subscription' } });
  const result = buildQuotaHistory([event(time(29, 16), reset, 10.22), api(time(29, 16, 30)), api(time(29, 17, 30))], q);
  const window = result.daily[0].windows[0];
  assert.equal(result.daily[0].usedPercent, 100);
  assert.equal(window.apiEquivalentUSD, 14.22);
  assert.equal(window.estimatedPer100USD, 12.22);
  assert.equal(window.subscriptionApiRequests, 2);
  assert.equal(window.subscriptionApiEquivalentUSD, 4);
  assert.equal(window.completionSource, 'account-rate-limits');
});

test('subscription API attribution respects early resets and expired windows', () => {
  const reset = time(29, 20), nextReset = time(29, 22);
  const q = [snapshot(time(29, 15), 0, reset), snapshot(time(29, 16), 86, reset),
    snapshot(time(29, 17), 0, nextReset), snapshot(time(29, 18), 20, nextReset)];
  const api = timestamp => ({ ...event(timestamp, null, 2), pricingContext: { billingMode: 'chatgpt-subscription' } });
  const result = buildQuotaHistory([api(time(29, 16, 30)), api(time(29, 17, 30)), api(time(29, 23))], q);
  assert.deepEqual(result.daily[0].windows.map(row => row.subscriptionApiEquivalentUSD), [2, 2]);
  assert.equal(result.daily[0].unattributedApiEquivalentUSD, 2);
});

test('idle zero-percent polling does not start a window or absorb the next real counter', () => {
  const reset = time(30, 9, 59), afternoon = time(30, 23, 3);
  const q = [snapshot(time(30, 3, 16), 0, time(30, 8, 16)),
    snapshot(time(30, 4), 0, time(30, 9)), snapshot(time(30, 4, 58), 0, time(30, 9, 58)),
    snapshot(time(30, 5), 7, reset), snapshot(time(30, 8, 20), 10, reset), snapshot(time(30, 9, 58), 94, reset),
    snapshot(time(30, 15, 5), 0, time(30, 20, 5)), snapshot(time(30, 17, 58), 0, time(30, 22, 58)),
    snapshot(time(30, 18, 4), 1, afternoon), snapshot(time(30, 20), 60, afternoon)];
  const subscription = { ...event(time(30, 5), null, 0.25), pricingContext: { billingMode: 'chatgpt-subscription' } };
  const e = [subscription, event(time(30, 8, 20), reset, 10),
    event(time(30, 18, 4), afternoon, 1), event(time(30, 20), afternoon, 7)];
  const result = buildQuotaHistory(e, q);
  const day = result.daily[0];
  assert.deepEqual(day.windows.map(row => [row.startsAt, row.resetsAt]),
    [[time(30, 4, 59), reset], [time(30, 18, 3), afternoon]]);
  assert.deepEqual(day.windows.map(row => row.apiEquivalentUSD), [10.25, 8]);
  assert.deepEqual(day.windows.map(row => row.usedPercent), [94, 60]);
  assert.equal(day.usedPercent, 154);
  assert.equal(day.apiEquivalentUSD, 18.25);
  assert.equal(day.unattributedApiEquivalentUSD, 0);
  assert.ok(day.windows.every(row => row.displayEndsAt - row.startsAt === 5 * 60 * 60_000));
});

test('idle polling can end a day at zero without publishing a usage window', () => {
  const result = buildQuotaHistory([], [snapshot(time(30, 3, 16), 0, time(30, 8, 16)),
    snapshot(time(30, 4, 59), 0, time(30, 9, 59))]);
  assert.equal(result.daily[0].usedPercent, 0);
  assert.equal(result.daily[0].windows.length, 0);
  assert.equal(result.windows.length, 0);
  assert.equal(result.latest.usedPercent, 0);
});

test('a measured request rounded to zero still has a window and its cost is retained', () => {
  const reset = time(30, 20);
  const result = buildQuotaHistory([event(time(30, 15, 1), reset, 0.01)],
    [snapshot(time(30, 15, 1), 0, reset)]);
  assert.equal(result.daily[0].usedPercent, 0);
  assert.equal(result.daily[0].windows.length, 1);
  assert.equal(result.daily[0].windows[0].startsAt, time(30, 15));
  assert.equal(result.daily[0].windows[0].apiEquivalentUSD, 0.01);
  assert.equal(result.daily[0].windows[0].estimatedPer100USD, null);
});

test('a partially priced interval keeps its subtotal but cannot become a full-allowance dollar estimate', () => {
  const reset = time(30,20);
  const rows = [event(time(30,16),reset,2),{...event(time(30,17),reset,1),costComplete:false}];
  const history = buildQuotaHistory(rows,[snapshot(time(30,15),0,reset),snapshot(time(30,16),50,reset),snapshot(time(30,17),100,reset)]);
  const day = history.daily[0];
  assert.equal(day.apiEquivalentUSD,3);
  assert.equal(day.usedPercent,100);
  assert.equal(day.costComplete,false);
  assert.equal(day.incompleteRequests,1);
  assert.equal(day.averagePer100USD,null);
  assert.equal(day.windows[0].estimatedPer100USD,null);
  assert.equal(history.completedWindows[0].apiEquivalentAt100,null);
  assert.equal(history.completedWindows[0].costComplete,false);
  const zero = buildQuotaHistory([event(time(30,16),reset,0)],
    [snapshot(time(30,15),0,reset),snapshot(time(30,16),50,reset)]).daily[0];
  assert.equal(zero.costComplete,true);
  assert.equal(zero.averagePer100USD,0,'A reported zero remains distinct from missing pricing');
});
