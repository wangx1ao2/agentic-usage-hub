'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSourceIndex } = require('../lib/source-index');
const { parseUsageLog } = require('../lib/log-parsers');
const { parseRecords } = require('../lib/codex-request-usage');
const { projectsFromRecords } = require('../lib/project-records');
const { aggregateRecords } = require('../lib/usage-aggregate');

test('file lifecycle retains last good contributions after read/discovery errors and reports recovery', t => {
  const root = path.join(process.env.HOME, 'lifecycle');
  fs.mkdirSync(root, { recursive: true });
  const filename = path.join(root, 'usage.jsonl');
  const row = JSON.stringify({ timestamp: '2026-10-18T12:00:00+08:00', model: 'qwen-plus',
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } }) + '\n';
  fs.writeFileSync(filename, row);
  let unreadable = false, inaccessible = false;
  const io = { ...fs,
    readFileSync: (...args) => { if (unreadable) { const error = new Error('fixture read failure'); error.code = 'EACCES'; throw error; } return fs.readFileSync(...args); },
    readdirSync: (...args) => { if (inaccessible) { const error = new Error('fixture traversal failure'); error.code = 'EACCES'; throw error; } return fs.readdirSync(...args); } };
  let now = Date.now();
  const index = createSourceIndex({ source: 'qwen', paths: () => [root], io, now: () => now,
    parse: (content, name) => parseUsageLog('qwen', content, name) });
  assert.equal(index.getRecords(true).length, 1);
  const success = index.getDiagnostics().lastSuccessfulAt;
  fs.appendFileSync(filename, '\n'); // A changed file must actually be reread.
  unreadable = true; now += 100;
  assert.equal(index.getRecords(true).length, 1);
  assert.equal(index.getDiagnostics().readErrors, 1);
  assert.equal(index.getDiagnostics().lastSuccessfulAt, success);
  unreadable = false; inaccessible = true; now += 100;
  assert.equal(index.getRecords(true).length, 1);
  assert.equal(index.getDiagnostics().readErrors, 1);
  inaccessible = false; now += 100;
  fs.writeFileSync(filename, row + '{broken}\n' + '{"usageMetadata":');
  assert.equal(index.getRecords(true).length, 1);
  assert.equal(index.getDiagnostics().parseErrors, 1);
  assert.equal(index.getDiagnostics().pendingLines, 1);
  assert.equal(index.getDiagnostics().lastSuccessfulAt, success);
  fs.writeFileSync(filename, row); now += 100;
  assert.equal(index.getRecords(true).length, 1);
  assert.equal(index.getDiagnostics().stale, false);
  assert.notEqual(index.getDiagnostics().lastSuccessfulAt, success);
  fs.unlinkSync(filename); now += 100;
  assert.equal(index.getRecords(true).length, 0);
  assert.equal(index.getDiagnostics().status, 'empty');
});

test('Claude message IDs reused by different request IDs retain each request while deduplicating its stream', () => {
  const row = (requestId, input, cached, output) => JSON.stringify({ type:'assistant',
    timestamp:'2026-11-18T04:00:00Z', sessionId:'sample-session', requestId,
    message:{id:'reused-message',model:'claude-sonnet-4-6',usage:{input_tokens:input,
      cache_read_input_tokens:cached,output_tokens:output}} });
  const parsed = parseUsageLog('claude', [row('a',100,20,5),row('a',100,20,10),
    row('b',200,30,20),row('b',200,30,20)].join('\n')+'\n','sample.jsonl');
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records.reduce((sum,row)=>sum+row.totalTokens,0), 380);
  assert.equal(parsed.records.reduce((sum,row)=>sum+row.outputTokens,0), 30);
  assert.equal(new Set(parsed.records.map(row=>row.id)).size, 2);
  assert.ok(parsed.records.every(row=>row.pricingContext.usageIdentity==='request-and-message-id'));
});

test('logged zero cost remains reported and split cache writes are counted once when the aggregate field is missing', () => {
  const parsed = parseUsageLog('claude', JSON.stringify({timestamp:'2026-11-19T04:00:00Z',costUSD:0,
    message:{id:'msg-zero',model:'unknown-free-route',usage:{input_tokens:100,output_tokens:10,
      cache_read_input_tokens:20,cache_creation:{ephemeral_5m_input_tokens:30,ephemeral_1h_input_tokens:40}}}})+'\n','sample.jsonl');
  const [record]=parsed.records;
  assert.equal(record.totalTokens,200);
  assert.equal(record.cacheWriteTokens,70);
  assert.equal(record.costUSD,0);
  assert.equal(record.costBasis,'reported');
  assert.equal(record.unpriced,false);
  assert.equal(record.costComplete,true);
});

test('undated messages are diagnosed and a completed message snapshot replaces earlier streaming usage', () => {
  const row = output => JSON.stringify({ timestamp: '2026-10-18T12:00:00+08:00', cwd: '/workspace/alpha',
    message: { id: 'request-a', model: 'claude-3-7-sonnet', usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: output } } });
  const parsed = parseUsageLog('claude', row(5) + '\n' + row(10) + '\n'
    + JSON.stringify({ usage: { input_tokens: 100 }, model: 'claude-3-7-sonnet' }) + '\n', '/logs/chat.jsonl');
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].totalTokens, 130);
  assert.equal(parsed.undatedRecords, 1);
  assert.equal(parsed.records[0].projectPath, '/workspace/alpha');
});

function isolateSources(t) {
  for (const [file, daily] of [['zcode-adapter', 'getZCodeDaily'], ['antigravity-adapter', 'getAntigravityDaily'],
    ['openclaw-adapter', 'getOpenClawAndReasonixDaily'], ['qwen-adapter', 'getQwenDaily'], ['qoderwork-adapter', 'getQoderDaily']]) {
    const adapter = require(`../${file}`);
    t.mock.method(adapter, daily, () => []);
    t.mock.method(adapter, 'getUsageRecords', () => []);
  }
  t.mock.method(require('../lib/log-sources').sources.claude, 'getRecords', () => []);
  t.mock.method(require('../codex-image-adapter'), 'getCodexImageAnalysis', () => ({
    totals: { totalCount: 0, totalCost: 0, totalTokens: 0 }, daily: [], recentImages: [] }));
}

test('Codex projects use matched requests and resumed usage dates without reading thread token estimates', t => {
  isolateSources(t);
  const { events } = parseRecords([
    { type: 'session_meta', timestamp: '2026-05-01T00:00:00Z', payload: { id: 'old-chat', cwd: 'F:/work/alpha' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    { type: 'event_msg', timestamp: '2026-10-18T04:00:00Z', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, total_tokens: 120 },
      last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, total_tokens: 120 } } } }
  ]);
  events[0].cost = 1; // A captured first-index amount can differ from today's catalog.
  events[0].speedKnown = true;
  const reset = events[0].timestamp + 3_600_000;
  events[0].quotaReset = reset;
  const service = require('../lib/usage-service');
  const raw = { daily: [{ date: '2026-10-18', inputTokens: 20, cacheReadTokens: 80, outputTokens: 20, totalTokens: 120,
    modelBreakdowns: [{ modelName: 'gpt-6.1-sol', agent: 'codex', inputTokens: 20, cacheReadTokens: 80,
      outputTokens: 20, totalTokens: 120, cost: events[0].cost }] }], requestRecords: events,
    quotaSnapshots: [{ timestamp: events[0].timestamp - 1000, usedPercent: 0, resetsAt: reset, windowMinutes: 300 },
      { timestamp: events[0].timestamp, usedPercent: 100, resetsAt: reset, windowMinutes: 300 }] };
  t.mock.method(service.codexLoader, 'getCodexDataSync', () => raw);
  const data = service.buildDashboardData();
  assert.deepEqual(data.meta.sources.ccusage.coverage, { from: '2026-10-18', to: '2026-10-18' });
  const project = data.projects.find(row => row.primaryPath === 'F:/work/alpha');
  assert.ok(project);
  assert.equal(project.lastActive, '2026-10-18');
  assert.equal(project.lastUsageAt, '2026-10-18T04:00:00.000Z');
  assert.equal(project.requestCount, 1);
  assert.equal(project.totalTokens, 120);
  assert.equal(project.cacheTokens, 80);
  assert.equal(project.totalCost, data.totals.totalCostUSD);
  assert.equal(project.daily.find(day => day.date === '2026-10-18').totalTokens, 120);
  assert.equal(service.getUsageRecords()[0].granularity, 'request');
  assert.equal(data.codexQuota.daily[0].apiEquivalentUSD, project.totalCost);
  assert.equal(data.codexQuota.daily[0].unknownSpeedRequests, 0);
  const current = service.buildDashboardData('standard', 'all', { pricingMode: 'current' });
  assert.notEqual(current.totals.totalCostUSD, data.totals.totalCostUSD);
  assert.equal(current.codexQuota.daily[0].apiEquivalentUSD, current.totals.totalCostUSD);
  // A different aggregate snapshot must stay explicitly unassigned.
  raw.daily[0].modelBreakdowns[0].totalTokens = 121;
  const mismatch = service.buildDashboardData();
  assert.equal(mismatch.projects[0].attribution, 'unattributed');
  assert.equal(mismatch.meta.unmatchedRequestDetails, 1);
  assert.equal(mismatch.totals.totalTokens, 121);
});

test('project daily/source/model sums are derived from the same ledger and cannot inflate unassigned usage', () => {
  const parsed = parseUsageLog('qwen', [
    { timestamp: '2026-10-17T12:00:00+08:00', cwd: '/team-a/project', model: 'qwen-plus', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } },
    { timestamp: '2026-10-18T12:00:00+08:00', cwd: '/team-a/project', model: 'qwen-plus', usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } },
    { timestamp: '2026-10-18T13:00:00+08:00', model: 'qwen-plus', usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 60 } }
  ].map(row => JSON.stringify(row)).join('\n'), '/log/usage.jsonl');
  const projects = projectsFromRecords(parsed.records, '2026-10-18');
  const all = aggregateRecords(parsed.records, { today: '2026-10-18' });
  assert.equal(projects.reduce((sum, project) => sum + project.totalTokens, 0), all.totals.totalTokens);
  assert.ok(Math.abs(projects.reduce((sum, project) => sum + project.totalCost, 0) - all.totals.totalCostUSD) < 0.000001);
  const named = projects.find(row => row.primaryPath === '/team-a/project');
  assert.equal(named.todayTokens, 240);
  assert.equal(named.daily.reduce((sum, day) => sum + day.totalTokens, 0), named.totalTokens);
  const unassigned = projects.find(row => row.attribution === 'unattributed');
  assert.equal(unassigned.totalTokens, 360);
  assert.equal(unassigned.primaryPath, '');
});

test('SQLite request attribution uses actual model usage and keeps a last good snapshot on schema failure', {
  skip: !require('../lib/runtime-capabilities').getRuntimeCapabilities().sqlite
}, () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = path.join(process.env.HOME, 'zcode-fixture');
  fs.mkdirSync(dir, { recursive: true });
  process.env.ZCODE_DB_PATH = path.join(dir, 'usage.sqlite');
  const db = new DatabaseSync(process.env.ZCODE_DB_PATH);
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE model_usage (id TEXT, session_id TEXT, started_at INTEGER, model_id TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_input_tokens INTEGER, computed_total_tokens INTEGER);');
  db.prepare('INSERT INTO session VALUES (?, ?)').run('session', '/fixture/zcode');
  db.prepare('INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('request', 'session', Date.parse('2026-10-18T04:00:00Z'), 'GLM-5.3-Flash', 100, 20, 80, 120);
  const source = require('../lib/zcode-source');
  const records = source.getRecords('standard', true);
  assert.equal(records[0].inputTokens, 20);
  assert.equal(records[0].cacheReadTokens, 80);
  assert.equal(records[0].projectPath, '/fixture/zcode');
  db.exec('DROP TABLE model_usage');
  assert.equal(source.getRecords('standard', true).length, 1);
  assert.equal(source.getDiagnostics().readErrors, 1);
  assert.equal(source.getDiagnostics().stale, true);
  db.close();
});
