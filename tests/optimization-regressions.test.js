'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

test('Qwen file contributions survive appends, same-mtime growth, truncation, rotation and deletion without duplication', t => {
  const root = process.env.QWEN_SESSIONS_DIR;
  const dir = path.join(root, 'demo', 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'chat.jsonl');
  const row = JSON.stringify({ timestamp: '2026-10-01T12:00:00+08:00', model: 'qwen-plus',
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }) + '\n';
  fs.writeFileSync(filename, row);
  const qwen = require('../qwen-adapter');
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const total = force => qwen.getQwenDaily(force).reduce((sum, day) => sum + day.totalTokens, 0);
  assert.equal(total(true), 120);
  const stat = fs.statSync(filename);
  fs.appendFileSync(filename, row);
  fs.utimesSync(filename, stat.atime, stat.mtime);
  now += 61_000;
  assert.equal(total(false), 240);
  assert.equal(total(true), 240);
  fs.writeFileSync(filename, row);
  now += 61_000;
  assert.equal(total(false), 120);
  fs.renameSync(filename, `${filename}.old`);
  fs.writeFileSync(filename, row + row);
  now += 61_000;
  assert.equal(total(false), 240);
  fs.unlinkSync(filename);
  now += 61_000;
  assert.equal(total(false), 0);
  // The explicitly configured usage file is also discovered under this root.
  process.env.QWEN_USAGE_FILE = path.join(dir, 'usage.jsonl');
  fs.writeFileSync(process.env.QWEN_USAGE_FILE, row);
  assert.equal(total(true), 120);
});

test('Claude project pricing treats fresh input separately from cache', t => {
  const dir = path.join(os.homedir(), '.claude', 'projects', 'fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), JSON.stringify({ cwd: '/fixture/project', timestamp: new Date().toISOString(),
    message: { model: 'claude-3-7-sonnet', usage: { input_tokens: 1_000_000,
      output_tokens: 500_000, cache_read_input_tokens: 200_000 } } }));
  const project = require('../project-adapter').getProjectAttributionList().find(row => row.primaryPath === '/fixture/project');
  assert.equal(project.totalCost, 10.56);
  assert.equal(project.totalTokens, 1_700_000);
  t.after(() => { fs.unlinkSync(path.join(dir, 'usage.jsonl')); require('../lib/log-sources').sources.claude.invalidate(); });
});

function mockSources(t, raw = { daily: [] }) {
  const service = require('../lib/usage-service');
  t.mock.method(service.codexLoader, 'getCodexDataSync', () => raw);
  t.mock.method(require('../lib/log-sources').sources.claude, 'getRecords', () => []);
  t.mock.method(require('../codex-image-adapter'), 'getCodexImageAnalysis', () => ({
    totals: { totalCount: 0, totalCost: 0, totalTokens: 0 }, daily: [], recentImages: [] }));
  for (const [file, method] of [['zcode-adapter', 'getZCodeDaily'], ['antigravity-adapter', 'getAntigravityDaily'],
    ['openclaw-adapter', 'getOpenClawAndReasonixDaily'], ['qwen-adapter', 'getQwenDaily'],
    ['qoderwork-adapter', 'getQoderDaily'], ['project-adapter', 'getProjectAttributionList']]) {
    t.mock.method(require(`../${file}`), method, () => []);
  }
  service.invalidateDashboardCache();
  service.invalidateProjectsCache();
  return service;
}

test('same model retains source identity and all rollup sums agree', t => {
  const date = require('../lib/date').getLocalDateStr();
  const row = (agent, tokens, cost) => ({ modelName: 'gpt-6.1-sol', agent, inputTokens: tokens,
    outputTokens: 0, cacheReadTokens: 0, totalTokens: tokens, cost });
  const service = mockSources(t, { daily: [{ date, inputTokens: 100, totalTokens: 100, modelBreakdowns: [row('codex', 100, 1)] }] });
  t.mock.method(require('../openclaw-adapter'), 'getOpenClawAndReasonixDaily', () => [{ date,
    modelBreakdowns: [row('openclaw', 200, 2)], totalTokens: 200, totalCost: 2 }]);
  const data = service.buildDashboardData();
  const model = data.todaySummary.byModel['gpt-6.1-sol'];
  assert.equal(model.agent, 'mixed');
  assert.deepEqual(model.agents.sort(), ['codex', 'openclaw']);
  assert.equal(model.bySource.codex.tokens, 100);
  assert.equal(model.bySource.openclaw.tokens, 200);
  assert.equal(data.totals.totalTokens, 300);
  assert.equal(data.totals.totalTokens, data.models.reduce((sum, row) => sum + row.totalTokens, 0));
  assert.equal(data.totals.totalTokens, Object.values(data.agentBreakdown).reduce((sum, row) => sum + row.totalTokens, 0));
  assert.equal(data.totals.totalTokens, service.getUsageRecords().reduce((sum, row) => sum + row.totalTokens, 0));
  assert.equal(data.totals.totalCostUSD, data.companies.reduce((sum, row) => sum + row.totalCost, 0));
});

test('ZCode price comparison is independent of the selected tier', t => {
  const service = mockSources(t);
  const date = require('../lib/date').getLocalDateStr();
  t.mock.method(require('../zcode-adapter'), 'getZCodeDaily', tier => [{ date, totalCost: tier === 'flagship' ? 3 : 1,
    totalTokens: 100, inputTokens: 100, modelBreakdowns: [] }]);
  for (const tier of ['standard', 'flagship']) {
    const data = service.buildDashboardData(tier);
    assert.equal(data.zcodePricingInfo.standardCostTotal, 1);
    assert.equal(data.zcodePricingInfo.flagshipCostTotal, 3);
  }
});

test('failed loader refresh reports partial failure and preserves other source results', async t => {
  const service = mockSources(t);
  t.mock.method(service.codexLoader, 'forceRefresh', async () => false);
  const report = await service.refreshSources();
  assert.equal(report.success, false);
  assert.equal(report.partial, true);
  assert.equal(report.sources.find(row => row.source === 'ccusage').success, false);
  assert.equal(report.sources.find(row => row.source === 'ccusage').lastSuccessfulAt, null);
  assert.ok(report.sources.find(row => row.source === 'qwen').lastSuccessfulAt);
});

test('MCP rejects malformed envelopes and invalid parameters, including impossible calendar dates', async () => {
  const mcp = require('../mcp/server');
  for (const value of [null, [], 1, 'text', {}, { jsonrpc: '2.0', id: {}, method: 'ping' }]) {
    assert.equal((await mcp.handleMessage(value)).error.code, -32600);
  }
  assert.equal((await mcp.handleMessage({ jsonrpc: '2.0', id: 0, method: 'ping' })).id, 0);
  assert.equal(await mcp.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  for (const [name, args] of [['get_usage_today', null], ['get_usage_today', { tier: 'other' }],
    ['get_usage_range', { startDate: '2026-02-30' }], ['get_usage_range', { startDate: '2026-03-01', endDate: '2026-02-01' }],
    ['get_usage_range', { groupBy: 'agent' }], ['get_project_breakdown', { limit: 1.5 }], ['get_project_breakdown', { limit: '5' }]]) {
    assert.equal((await mcp.handleToolCall(1, { name, arguments: args })).error.code, -32602);
  }
});

test('a failed first manual refresh preserves the successful passive source read time', async t => {
  const service = mockSources(t);
  const lastSuccessfulAt = '2026-10-18T01:00:00.000Z';
  t.mock.method(service.codexLoader, 'forceRefresh', async () => true);
  t.mock.method(require('../lib/log-sources').sources.qwen, 'getDiagnostics', () => ({
    lastSuccessfulAt, readErrors: 1, stale: true, error: 'fixture read failure' }));
  const result = await service.refreshSources();
  const failed = result.sources.find(row => row.source === 'qwen');
  assert.equal(failed.success, false);
  assert.equal(failed.lastSuccessfulAt, lastSuccessfulAt);
  assert.equal(service.getSourceStatus().qwen.lastSuccessfulAt, lastSuccessfulAt);
});

test('MCP stdio stays alive after a null message and responds to id zero', async () => {
  const child = spawn(process.execPath, ['bin/agentic-usage-hub.js', '--mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.stdin.end('null\n{"jsonrpc":"2.0","id":0,"method":"ping"}\n');
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`MCP transport timed out: ${stderr}`)); }, 15000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 0, stderr);
  const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(messages.some(row => row.error?.code === -32600));
  assert.ok(messages.some(row => row.id === 0 && row.result));
});
