'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRecords, applyRequestPricing, priceRequest } = require('../lib/codex-request-usage');
const { normalizeCcusageDaily, getCcusageBreakdownCost } = require('../lib/ccusage-normalize');
const { normalizeDaily } = require('../lib/usage-record');
const { aggregateRecords } = require('../lib/usage-aggregate');
const { createRequestRecord } = require('../lib/request-record');
const { reconcileRequests } = require('../lib/record-reconciliation');

function request(id, model, input, cached, output, serviceTier = 'default') {
  const timestamp = '2026-10-28T04:30:00Z';
  const usage = { input_tokens: input + cached, cached_input_tokens: cached,
    output_tokens: output, total_tokens: input + cached + output };
  return parseRecords([
    { type: 'session_meta', payload: { id, cwd: 'F:/fixture',
      source: model === 'codex-auto-review' ? { subagent: { other: 'guardian' } } : 'cli' } },
    { type: 'turn_context', payload: { model, service_tier: serviceTier } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count',
      info: { total_token_usage: usage, last_token_usage: usage } } }
  ]);
}

function fixture() {
  const guardian = request('guardian', 'codex-auto-review', 100, 200, 10);
  const actual = request('actual-gpt', 'gpt-5.5', 1000, 2000, 100);
  const terra = request('terra', 'gpt-6.1-terra', 500, 600, 20);
  const day = { date: guardian.events[0].date, inputTokens: 1600, cacheReadTokens: 2800,
    outputTokens: 130, totalTokens: 4530, totalCost: 99, modelsUsed: ['gpt-5.5', 'gpt-6.1-terra'],
    modelBreakdowns: [
      { modelName: 'gpt-5.5', agent: 'codex', inputTokens: 1100, cacheReadTokens: 2200, outputTokens: 110, cost: 99 },
      { modelName: 'gpt-6.1-terra', agent: 'codex', inputTokens: 500, cacheReadTokens: 600, outputTokens: 20, cost: 0 }
    ] };
  return { data: { daily: [day] }, results: [guardian, actual, terra], guardian };
}

test('raw reviewer ID replaces the native fallback while preserving genuine GPT-5.5 and all tokens', () => {
  const { data, results, guardian } = fixture();
  const claude = { modelName: 'claude-sonnet-5', agent: 'claude', inputTokens: 1, cacheReadTokens: 2, outputTokens: 3, cost: 4 };
  data.daily[0].modelBreakdowns.push(claude);
  applyRequestPricing(data, [...results, guardian]);
  const day = data.daily[0];
  const review = day.modelBreakdowns.find(row => row.modelName === 'codex-auto-review');
  assert.equal(review.totalTokens, 310);
  assert.equal(review.cost, 0.00032);
  assert.equal(review.unpriced, false);
  assert.deepEqual(getCcusageBreakdownCost(review.modelName, { ...review, cost: 99 }), { cost: 0.00032, estimated: true, unpriced: false });
  assert.equal(day.modelBreakdowns.find(row => row.modelName === 'gpt-5.5').inputTokens, 1000);
  assert.equal(day.modelBreakdowns.find(row => row.modelName === 'gpt-5.5').cost, 0.009);
  assert.equal(day.modelBreakdowns.find(row => row.agent === 'claude'), claude);
  assert.equal(day.totalTokens, 4530);
  assert.ok(day.modelsUsed.includes('codex-auto-review'));
  const first = JSON.stringify(data);
  applyRequestPricing(data, results);
  assert.equal(JSON.stringify(data), first);
});

test('today totals and request attribution price the reviewer using the assumed Sol rate', () => {
  const { data, guardian } = fixture();
  data.daily[0] = { date: guardian.events[0].date, totalTokens: 310, modelBreakdowns: [
    { modelName: 'gpt-5.5', agent: 'codex', inputTokens: 100, cacheReadTokens: 200, outputTokens: 10, cost: 0.0009 }
  ] };
  applyRequestPricing(data, [guardian]);
  const aggregates = normalizeDaily(normalizeCcusageDaily(data), 'ccusage', { freshInput: true });
  const requests = data.requestRecords.map(row => createRequestRecord({ source: 'codex', id: row.key,
    model: row.model, rawModel: row.model, timestamp: row.timestamp, sessionId: row.sessionId,
    projectPath: row.cwd, inputTokens: row.inputTokens, cacheReadTokens: row.cacheReadTokens,
    outputTokens: row.outputTokens, costUSD: row.unpriced ? undefined : row.cost }));
  const reconciled = reconcileRequests(aggregates, requests);
  assert.equal(reconciled.unmatched.length, 0);
  assert.equal(reconciled.records[0].granularity, 'request');
  const dashboard = aggregateRecords(reconciled.records, { today: data.daily[0].date });
  assert.deepEqual(Object.keys(dashboard.today.byModel), ['codex-auto-review']);
  assert.equal(dashboard.today.byModel['codex-auto-review'].unpriced, false);
  assert.equal(dashboard.totals.totalTokens, 310);
  assert.equal(dashboard.totals.totalCostUSD, 0.00032);
  assert.equal(dashboard.totals.costComplete, true);
});

test('reviewer rates match Sol per request, including context and speed, and are clearly marked as assumed', () => {
  const usage = { input_tokens: 272001, cached_input_tokens: 200000, output_tokens: 10000 };
  const review = priceRequest('codex-auto-review', usage, 'priority');
  const sol = priceRequest('gpt-6.1-sol', usage, 'priority');
  assert.equal(review.cost, sol.cost);
  assert.equal(review.longContext, true);
  assert.equal(review.pricingContext.assumedRateModel, 'gpt-6.1-sol');
  assert.equal(review.pricingContext.rateBasis, 'user-selected-assumption');
  const legacy = { key: 'legacy', model: 'codex-auto-review', timestamp: Date.parse('2026-10-28T04:30:00Z'),
    date: '2026-10-28', inputTokens: 100, cacheReadTokens: 200, outputTokens: 10,
    cost: 0, standardCost: 0, unpriced: true, speedKnown: false };
  const result = applyRequestPricing({ daily: [] }, [{ events: [legacy], snapshots: [] }]);
  assert.equal(result.requestRecords[0].cost, 0.00032);
  assert.equal(result.requestRecords[0].unpriced, false);
  assert.equal(result.requestRecords[0].speedKnown, false);
  assert.equal(result.codexQuota.daily[0].apiEquivalentUSD, 0.00032);
});

test('historical rate snapshots can apply their Sol rate to the reviewer assumption', () => {
  const path = require('node:path');
  const { createPricingHistory } = require('../lib/pricing-history');
  const { MODEL_CATALOG } = require('../models-pricing');
  const directory = path.join(process.env.HOME, 'review-price-history');
  const old = createPricingHistory({ directory, catalog: { 'gpt-6.1-sol': MODEL_CATALOG['gpt-6.1-sol'] } });
  const previousVersion = old.metadata().currentVersion;
  old.persist();
  const history = createPricingHistory({ directory });
  const row = createRequestRecord({ source: 'codex', id: 'long-review', rawModel: 'codex-auto-review',
    timestamp: '2026-10-28T04:30:00Z', inputTokens: 72001, cacheReadTokens: 200000,
    outputTokens: 10000, costUSD: priceRequest('codex-auto-review',
      { input_tokens: 272001, cached_input_tokens: 200000, output_tokens: 10000 }, 'priority').cost,
    costBasis: 'user-assumed-sol-rate', pricingContext: { serviceTier: 'priority' } });
  assert.equal(row.costEstimated, true);
  assert.equal(history.apply([row], { pricingMode: 'current', pricingVersion: previousVersion })[0].costUSD, row.costUSD);
});

test('dashboard and the five-hour quota history share the reviewer assumption', t => {
  const { guardian } = fixture();
  const event = guardian.events[0], reset = event.timestamp + 3600000;
  event.quotaReset = reset;
  const snapshots = [
    { timestamp: reset - 5 * 3600000 + 1000, usedPercent: 0, resetsAt: reset, windowMinutes: 300 },
    { timestamp: event.timestamp + 1000, usedPercent: 100, resetsAt: reset, windowMinutes: 300 }
  ].map(snapshot => ({ ...snapshot, observedAt: new Date(snapshot.timestamp).toISOString() }));
  const data = { daily: [{ date: event.date, totalTokens: 310, modelBreakdowns: [{
    modelName: 'gpt-5.5', agent: 'codex', inputTokens: 100, cacheReadTokens: 200, outputTokens: 10, cost: 0.0009
  }] }] };
  applyRequestPricing(data, [{ events: [event], snapshots }]);
  for (const [file, daily] of [['zcode-adapter', 'getZCodeDaily'], ['antigravity-adapter', 'getAntigravityDaily'],
    ['openclaw-adapter', 'getOpenClawAndReasonixDaily'], ['qwen-adapter', 'getQwenDaily'], ['qoderwork-adapter', 'getQoderDaily']]) {
    const adapter = require(`../${file}`);
    t.mock.method(adapter, daily, () => []);
    t.mock.method(adapter, 'getUsageRecords', () => []);
  }
  const sources = require('../lib/log-sources').sources;
  t.mock.method(sources.claude, 'getRecords', () => []);
  t.mock.method(sources.api, 'getRecords', () => []);
  t.mock.method(require('../codex-image-adapter'), 'getCodexImageAnalysis', () => ({ totals: { totalCount: 0 }, daily: [] }));
  const service = require('../lib/usage-service');
  t.mock.method(service.codexLoader, 'getCodexDataSync', () => data);
  const dashboard = service.buildDashboardData();
  const row = dashboard.timeline.find(day => day.date === event.date).byModel['codex-auto-review'];
  assert.equal(row.cost, 0.00032);
  assert.equal(row.costEstimated, true);
  assert.equal(dashboard.codexQuota.completedWindows[0].apiEquivalentAt100, 0.00032);
  assert.equal(dashboard.codexQuota.completedWindows[0].unpricedRequests, 0);
  assert.ok(dashboard.meta.costNotice.includes('用户指定的 GPT-6.1 Sol'));
  const record = service.getUsageRecords().find(item => item.canonicalModel === 'codex-auto-review');
  assert.equal(record.costBasis, 'user-assumed-sol-rate');
  assert.equal(record.pricingContext.assumedRateModel, 'gpt-6.1-sol');
});

test('splitting reviewer fallback keeps the genuine model request speed price', () => {
  const { data, results } = fixture();
  results[1] = request('actual-gpt', 'gpt-5.5', 1000, 2000, 100, 'priority');
  applyRequestPricing(data, results);
  assert.equal(data.daily[0].modelBreakdowns.find(row => row.modelName === 'gpt-5.5').cost, 0.018);
});

test('incomplete coverage cannot relabel or remove native model totals', () => {
  for (const change of [data => { data.requestReadErrors = 1; }, data => { data.daily[0].modelBreakdowns[0].inputTokens++; }]) {
    const { data, results } = fixture();
    change(data);
    applyRequestPricing(data, results);
    assert.equal(data.daily[0].modelBreakdowns[0].modelName, 'gpt-5.5');
    assert.equal(data.daily[0].modelBreakdowns[0].cost, 99);
    assert.equal(data.daily[0].modelBreakdowns.length, 2);
  }
});
