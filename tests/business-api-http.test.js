'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('live HTTP scopes and refresh include business API usage in totals and its configured project', async t => {
  const root = path.join(process.env.HOME, 'business-http');
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  const filename = path.join(root, '.local', 'app.log');
  const day = require('../lib/date').getLocalDateStr();
  const row = id => `${day} 12:00:00 INFO AiService - AI响应: id=${id}, time=${day} 12:00:00, model=gpt-6.1-terra, promptTokens=1000, completionTokens=100, totalTokens=1100\n`;
  fs.writeFileSync(filename, 'secret-request-body-must-not-enter-ledger\n' + row('chatcmpl-codex-http-one'));
  process.env.BUSINESS_API_PROJECTS = root;
  const { hash } = require('../lib/persistent-cache');
  const quotaFile = path.join(process.env.AGENTIC_CACHE_DIR, 'codex-quota', `${hash([process.env.CODEX_HOME, 1])}.jsonl`);
  fs.mkdirSync(path.dirname(quotaFile), { recursive: true });
  const reset = new Date(`${day}T17:00:00`).getTime();
  const snapshot = (hour, usedPercent) => ({ timestamp: new Date(`${day}T${hour}:00:00`).getTime(),
    observedAt: `${day}T${hour}:00:00+08:00`, resetsAt: reset, usedPercent, windowMinutes: 300, source: 'account-rate-limits' });
  fs.writeFileSync(quotaFile, [snapshot('12', 0), snapshot('13', 86)].map(value => JSON.stringify(value)).join('\n') + '\n');
  const { server } = require('../unified-server');
  const service = require('../lib/usage-service');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.dispose(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async route => {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const dashboard = await get('/api/dashboard?agent=api');
  assert.equal(dashboard.meta.agentFilter, 'api');
  assert.equal(dashboard.totals.totalTokens, 1100);
  assert.equal(dashboard.agentBreakdown.api.totalTokens, 1100);
  assert.equal(dashboard.models[0].modelName, 'gpt-6.1-terra (业务 API)');
  assert.equal(dashboard.codexQuota.daily[0].windows[0].usedPercent, 86);
  assert.equal(dashboard.codexQuota.daily[0].windows[0].subscriptionApiRequests, 1);
  assert.equal(dashboard.codexQuota.daily[0].windows[0].apiEquivalentUSD, 0.0015);
  const detail = await get('/api/usage-records?agent=api');
  assert.equal(detail.totalCount, 1);
  assert.equal(detail.records[0].projectPath, root);
  assert.equal(detail.records[0].costUSD, 0.0015);
  const projects = await get('/api/projects?agent=api');
  assert.equal(projects.projects[0].totalTokens, 1100);
  assert.equal(projects.projects[0].primaryPath, root);
  const exported = await get('/api/export?format=json&agent=api');
  assert.equal(exported.records.length, 1);
  assert.ok(!JSON.stringify(exported).includes('secret-request-body'));
  fs.appendFileSync(filename, row('chatcmpl-codex-http-two'));
  fs.appendFileSync(quotaFile, JSON.stringify(snapshot('14', 100)) + '\n');
  await get('/api/refresh');
  const updated = await get('/api/usage-records?agent=api');
  assert.equal(updated.totalCount, 2);
  assert.equal(updated.totals.totalTokens, 2200);
  assert.equal((await get('/api/sources')).sources.api.requests, 2);
  const quota = (await get('/api/dashboard')).codexQuota.daily[0].windows[0];
  assert.equal(quota.usedPercent, 100);
  assert.equal(quota.subscriptionApiRequests, 2);
  assert.equal(quota.apiEquivalentUSD, 0.003);
  assert.equal(quota.estimatedPer100USD, 0.003);
  await get('/api/refresh');
  const repeated = (await get('/api/dashboard?agent=api')).codexQuota.daily[0].windows[0];
  assert.equal(repeated.apiEquivalentUSD, quota.apiEquivalentUSD);
  assert.equal(repeated.subscriptionApiRequests, 2);
  fs.appendFileSync(filename, row('chatcmpl-codex-http-background'));
  // No HTTP reads or refreshes: the worker must still persist the next call.
  const ledgerDir = path.join(process.env.AGENTIC_CACHE_DIR, 'business-api');
  const deadline = Date.now() + 15_000;
  let captured = false;
  while (Date.now() < deadline) {
    const contents = fs.readdirSync(ledgerDir).map(name => fs.readFileSync(path.join(ledgerDir, name), 'utf8')).join('\n');
    if (contents.includes('chatcmpl-codex-http-background')) { captured = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(captured, true, 'background polling must record usage without an open dashboard page');
});
