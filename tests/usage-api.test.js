'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { server } = require('../unified-server');
const service = require('../lib/usage-service');

test('diagnostics, request drilldown, actual-only scopes and exports use the same complete ledger', async t => {
  const today = require('../lib/date').getLocalDateStr();
  const dir = path.join(process.env.QWEN_SESSIONS_DIR, 'fixture', 'chats'); fs.mkdirSync(dir, { recursive: true });
  const secret = 'message-content-must-not-be-exported';
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), [
    { timestamp: '2026-10-17T04:00:00Z', cwd: 'C:/team/alpha', model: 'qwen-plus', text: secret,
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } },
    { timestamp: `${today}T04:00:00+08:00`, cwd: 'C:/team/alpha', model: 'qwen-plus', text: secret,
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40 } }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const qoder = path.join(process.env.QODER_SESSIONS_DIR, 'fixture'); fs.mkdirSync(qoder, { recursive: true });
  fs.writeFileSync(path.join(qoder, 'chat.jsonl'), [
    { type: 'user', uuid: 'user', timestamp: `${today}T04:00:00+08:00`, message: { content: 'x'.repeat(280) } },
    { type: 'assistant', timestamp: `${today}T04:00:01+08:00`, message: { id: 'assistant', model: 'qfmodel', content: 'x'.repeat(320) } }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.dispose(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async route => { const response = await fetch(base + route); assert.equal(response.status, 200); return response.json(); };
  const all = await get('/api/dashboard');
  const actual = await get('/api/dashboard?actualOnly=true');
  assert.equal(actual.totals.totalTokens, 360);
  assert.equal(all.totals.totalTokens, 560);
  assert.equal(all.totals.estimatedTokens, 200);
  const sources = await get('/api/sources');
  assert.equal(sources.sources.qwen.available, true);
  assert.equal(sources.sources.qwen.readErrors, 0);
  assert.equal(sources.sources.qwen.coverage.from, '2026-10-17');
  assert.ok(sources.sources.qwen.lastSuccessfulAt);
  assert.ok(sources.sources.qwen.paths.includes(path.resolve(process.env.QWEN_SESSIONS_DIR)));
  const projects = await get('/api/projects?actualOnly=true');
  assert.equal(projects.projects.reduce((sum, row) => sum + row.totalTokens, 0), actual.totals.totalTokens);
  const alpha = projects.projects.find(row => row.primaryPath === 'C:/team/alpha');
  assert.equal(alpha.todayTokens, 240);
  const query = `projectId=${alpha.id}&startDate=${today}&endDate=${today}&actualOnly=true`;
  const records = await get(`/api/usage-records?${query}&limit=1`);
  assert.equal(records.totalCount, 1);
  assert.equal(records.records[0].granularity, 'request');
  assert.equal(records.records[0].totalTokens, 240);
  const exported = await get(`/api/export?${query}&format=json`);
  assert.equal(exported.records.length, 1);
  assert.equal(exported.records[0].totalTokens, 240);
  assert.equal(exported.metadata.filters.projectId, alpha.id);
  assert.equal(exported.metadata.timezone, 'Asia/Shanghai');
  assert.ok(exported.metadata.pricing.currentVersion.startsWith('catalog-'));
  assert.ok(exported.records[0].pricingVersion);
  assert.equal(JSON.stringify(exported).includes(secret), false);
  const csv = await fetch(`${base}/api/export?${query}&format=csv`);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  assert.match(await csv.text(), /metadata.*exportedAt/);
  const current = await get('/api/dashboard?actualOnly=true&pricingMode=current');
  assert.equal(current.meta.pricing.mode, 'current');
  assert.equal(current.totals.totalTokens, actual.totals.totalTokens);
  const mcp = require('../mcp/server');
  const args = { actualOnly: true, agent: 'qwen', startDate: today, endDate: today, pricingMode: 'current' };
  const range = await mcp.handleToolCall(10, { name: 'get_usage_range', arguments: args });
  assert.equal(JSON.parse(range.result.content[0].text).totalTokens, 240);
  const breakdown = await mcp.handleToolCall(11, { name: 'get_project_breakdown', arguments: args });
  assert.equal(JSON.parse(breakdown.result.content[0].text).projects[0].totalTokens, 240);
  for (const argumentsValue of [{ actualOnly: 'true' }, { pricingVersion: 'catalog-' + '0'.repeat(24) },
    { pricingMode: 'current', pricingVersion: 'catalog-' + '0'.repeat(24) }]) {
    assert.equal((await mcp.handleToolCall(12, { name: 'get_usage_today', arguments: argumentsValue })).error.code, -32602);
  }
  for (const route of ['/api/usage-records?startDate=2026-02-30', '/api/usage-records?limit=0',
    '/api/projects?projectId=unsafe', '/api/export?format=html', '/api/export?limit=1',
    '/api/dashboard?pricingMode=invalid', '/api/dashboard?pricingMode=current&pricingVersion=catalog-' + '0'.repeat(24)]) {
    const response = await fetch(base + route); assert.equal(response.status, 400, route);
  }
});
