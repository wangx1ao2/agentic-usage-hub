'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseBusinessApiLog, createBusinessApiMonitor, apiRecord } = require('../lib/business-api-usage');
const { aggregateRecords } = require('../lib/usage-aggregate');
const { projectsFromRecords } = require('../lib/project-records');
const { parseUsageFilters, validateToolArguments } = require('../lib/validation');

const project = path.join(process.env.HOME, 'boss');
const line = (id = 'chatcmpl-codex-one', input = 1000, output = 100) =>
  `2026-10-28 19:00:00 [worker] INFO AiService - AI响应: id=${id}, time=2026-10-28 19:00:00, model=gpt-6.1-terra, promptTokens=${input}, completionTokens=${output}, totalTokens=${input + output}\n`;
const parsed = text => parseBusinessApiLog(text, 'server.log', project);

test('legacy business log counts real tokens and discloses the missing cache split', () => {
  const result = parsed('private prompt and authorization header are not telemetry\n' + line());
  assert.equal(result.records.length, 1);
  const row = result.records[0];
  assert.equal(row.source, 'api');
  assert.equal(row.model, 'gpt-6.1-terra (业务 API)');
  assert.equal(row.totalTokens, 1100);
  assert.equal(row.costUSD, 0.0015);
  assert.equal(row.estimated, false);
  assert.equal(row.costEstimated, true);
  assert.equal(row.pricingContext.cacheKnown, false);
  assert.equal(row.pricingContext.billingMode, 'chatgpt-subscription');
  assert.ok(!JSON.stringify(row).includes('private prompt'));
  const direct = parsed(line('deepseek-request')).records[0];
  assert.equal(direct.pricingContext.billingMode, 'api');
});

test('structured usage preserves cache, authoritative amounts and output reasoning without double counting', () => {
  const row = apiRecord({ requestId: 'exact-one', model: 'deepseek-flash', timestamp: '2026-10-28T19:00:00+08:00',
    usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100,
      prompt_tokens_details: { cached_tokens: 800 }, completion_tokens_details: { reasoning_tokens: 50 } } }, project);
  assert.equal(row.inputTokens, 200);
  assert.equal(row.cacheReadTokens, 800);
  assert.equal(row.outputTokens, 100);
  assert.equal(row.totalTokens, 1100);
  assert.equal(row.pricingContext.cacheKnown, true);
  assert.equal(row.costUSD, 0.000185);
  const reported = apiRecord({ requestId: 'paid', model: 'unknown-model', timestamp: '2026-10-28T19:00:00+08:00',
    costUSD: 0.25, usage: { input_tokens: 100, output_tokens: 20 } }, project);
  assert.equal(reported.costUSD, 0.25);
  assert.equal(reported.costBasis, 'reported');
  assert.equal(reported.unpriced, false);
});

test('incomplete, invalid and unknown-price records are distinguished', () => {
  const incomplete = parsed(line().trimEnd());
  assert.equal(incomplete.records.length, 0);
  assert.equal(incomplete.pendingLines, 1);
  assert.equal(parsed(line().replace('totalTokens=1100', 'totalTokens=1200')).parseErrors, 1);
  assert.equal(parsed(line().replace('promptTokens=1000', 'promptTokens=-1')).parseErrors, 1);
  const unknown = apiRecord({ requestId: 'x', model: 'future-api-model', timestamp: '2026-10-28T19:00:00+08:00',
    usage: { input_tokens: 100, output_tokens: 20 } }, project);
  assert.equal(unknown.unpriced, true);
  assert.equal(unknown.costUSD, null);
  for (const row of [null, [], { requestId: 1 }, { requestId: 'bad', model: 'gpt-6.1-terra', costUSD: -1 }]) {
    assert.equal(apiRecord(row, project), null);
  }
});

test('business API prices preserve individual long-context and speed settings on recalculation', () => {
  const row = apiRecord({ requestId: 'long', model: 'gpt-6.1-terra', timestamp: '2026-10-28T19:00:00+08:00',
    serviceTier: 'priority', usage: { input_tokens: 272001, cached_input_tokens: 200000, output_tokens: 10000 } }, project);
  assert.equal(row.pricingContext.longContext, true);
  assert.equal(row.costUSD, 0.478004);
  const history = require('../lib/pricing-history').createPricingHistory({ directory: path.join(process.env.HOME, 'api-price-history') });
  assert.equal(history.apply([row], { pricingMode: 'current' })[0].costUSD, row.costUSD);
});

test('polling, duplicate logs, restarts and rotation never lose or double count business requests', t => {
  const root = fs.mkdtempSync(path.join(process.env.HOME, 'business-lifecycle-'));
  const logs = path.join(root, '.local');
  const ledgerDir = path.join(root, 'monitor-cache');
  fs.mkdirSync(logs);
  const filename = path.join(logs, 'server.log');
  fs.writeFileSync(filename, line());
  let now = Date.now();
  const make = () => createBusinessApiMonitor({ projects: () => [root], ledgerDir, now: () => now });
  const monitor = make();
  assert.equal(monitor.getRecords().length, 1);
  fs.writeFileSync(path.join(logs, 'copied.log'), line());
  fs.appendFileSync(filename, line('chatcmpl-codex-two'));
  now += 10_001;
  assert.equal(monitor.getRecords().length, 2);
  assert.equal(monitor.getDiagnostics().requests, 2);
  assert.equal(make().getRecords().length, 2);
  fs.writeFileSync(filename, line('chatcmpl-codex-three'));
  fs.unlinkSync(path.join(logs, 'copied.log'));
  assert.equal(monitor.getRecords(true).length, 3);
  fs.unlinkSync(filename);
  assert.equal(make().getRecords().length, 3);
  const ledger = path.join(ledgerDir, fs.readdirSync(ledgerDir)[0]);
  const content = fs.readFileSync(ledger, 'utf8');
  fs.appendFileSync(ledger, '{broken');
  assert.equal(monitor.getRecords(true).length, 3);
  assert.equal(monitor.getDiagnostics().stale, true);
  assert.equal(fs.readFileSync(ledger, 'utf8'), content + '{broken');
  t.after(() => monitor.invalidate());
});

test('configured symlink and junction projects retain usage and their workspace identity', () => {
  const root = fs.mkdtempSync(path.join(process.env.HOME, 'business-realpath-'));
  const physical = path.join(root, 'workspace'), alias = path.join(root, 'alias');
  fs.mkdirSync(path.join(physical, '.local'), { recursive: true });
  fs.writeFileSync(path.join(physical, '.local', 'app.log'), line());
  fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const options = { projects: () => [alias], ledgerDir: path.join(root, 'ledger') };
  const monitor = createBusinessApiMonitor(options);
  const [record] = monitor.getRecords();
  assert.equal(record.totalTokens, 1100);
  assert.equal(record.projectPath, alias);
  assert.equal(monitor.getDiagnostics().requests, 1);
  assert.equal(createBusinessApiMonitor(options).getRecords()[0].id, record.id);
});

test('richer usage replaces a legacy copy without changing measured totals or request identity', () => {
  const root = fs.mkdtempSync(path.join(process.env.HOME, 'business-enrichment-'));
  const logs = path.join(root, '.local');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'server.log'), line());
  const monitor = createBusinessApiMonitor({ projects: () => [root], ledgerDir: path.join(root, 'cache') });
  const old = monitor.getRecords()[0];
  fs.writeFileSync(path.join(logs, 'ai-usage.jsonl'), JSON.stringify({ requestId: 'chatcmpl-codex-one',
    timestamp: '2026-10-28T19:00:00+08:00', model: 'gpt-6.1-terra',
    usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100 } }) + '\n');
  const records = monitor.getRecords(true);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, old.id);
  assert.equal(records[0].totalTokens, old.totalTokens);
  assert.equal(records[0].cacheReadTokens, 800);
  assert.ok(records[0].costUSD < old.costUSD);
});

test('business requests reach the dashboard ledger, project, API filters and exports once', t => {
  const source = require('../lib/log-sources').sources;
  for (const [file, daily] of [['zcode-adapter', 'getZCodeDaily'], ['antigravity-adapter', 'getAntigravityDaily'],
    ['openclaw-adapter', 'getOpenClawAndReasonixDaily'], ['qwen-adapter', 'getQwenDaily'], ['qoderwork-adapter', 'getQoderDaily']]) {
    const adapter = require(`../${file}`);
    t.mock.method(adapter, daily, () => []);
    t.mock.method(adapter, 'getUsageRecords', () => []);
  }
  t.mock.method(source.claude, 'getRecords', () => []);
  const records = parsed(line()).records;
  t.mock.method(source.api, 'getRecords', () => records);
  t.mock.method(source.api, 'getDiagnostics', () => ({ source: 'api', requests: 1, stale: false }));
  t.mock.method(require('../codex-image-adapter'), 'getCodexImageAnalysis', () => ({ totals: { totalCount: 0 }, daily: [] }));
  const service = require('../lib/usage-service');
  t.mock.method(service.codexLoader, 'getCodexDataSync', () => ({ daily: [], requestRecords: [], quotaSnapshots: [] }));
  const dashboard = service.buildDashboardData('standard', 'api');
  assert.equal(dashboard.totals.totalTokens, 1100);
  assert.equal(dashboard.agentBreakdown.api.totalTokens, 1100);
  assert.equal(dashboard.agentBreakdown.codex.totalTokens, 0);
  assert.equal(dashboard.projects[0].name, 'boss');
  assert.equal(dashboard.projects[0].requestCount, 1);
  assert.ok(dashboard.meta.costNotice.includes('全部新输入'));
  const aggregate = aggregateRecords(records, { agent: 'api', today: records[0].date });
  assert.equal(aggregate.today.totalTokens, projectsFromRecords(records)[0].totalTokens);
  assert.equal(parseUsageFilters(new URLSearchParams('agent=api')).agent, 'api');
  assert.equal(validateToolArguments('get_usage_range', { agent: 'api' }).agent, 'api');
  const exported = require('../lib/usage-export').exportUsage(records, dashboard.meta, { agent: 'api' });
  assert.equal(JSON.parse(exported.body).records[0].pricingContext.cacheKnown, false);
  // Paid API calls stay in the ledger and project totals, outside Codex quota.
  const paid = parsed(line('paid-api')).records[0];
  const timestamp = records[0].timestamp, reset = timestamp + 3 * 60 * 60_000;
  const snapshots = [{ timestamp: reset - 5 * 60 * 60_000, usedPercent: 0, resetsAt: reset, windowMinutes: 300 },
    { timestamp, usedPercent: 100, resetsAt: reset, windowMinutes: 300 }];
  t.mock.method(service.codexLoader, 'getCodexDataSync', () => ({ daily: [], requestRecords: [], quotaSnapshots: snapshots }));
  t.mock.method(source.api, 'getRecords', () => [...records, paid]);
  const withQuota = service.buildDashboardData('standard', 'api');
  assert.equal(withQuota.totals.totalTokens, 2200);
  assert.equal(withQuota.codexQuota.daily[0].apiEquivalentUSD, records[0].costUSD);
  assert.equal(withQuota.codexQuota.daily[0].windows[0].subscriptionApiRequests, 1);
});
