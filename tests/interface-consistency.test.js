'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { server } = require('../unified-server');
const service = require('../lib/usage-service');
const mcp = require('../mcp/server');

test('HTTP and MCP consume the same snapshot, including real freshness and coverage', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await service.dispose(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const dashboard = await (await fetch(`${base}/api/dashboard`)).json();
  const result = await mcp.handleToolCall(1, { name: 'get_usage_today' });
  const report = JSON.parse(result.result.content[0].text);
  assert.equal(report.totalTokens, dashboard.todaySummary.totalTokens);
  assert.equal(report.totalCostUSD, dashboard.todaySummary.totalCost);
  assert.equal(report.meta.lastSuccessfulAt, dashboard.meta.lastSuccessfulAt);
  assert.deepEqual(report.meta.recordCoverage, dashboard.meta.recordCoverage);
  assert.equal(dashboard.meta.recordCoverage.to, null, 'An injected empty calendar day is not log coverage');
  const capabilities = await (await fetch(`${base}/api/capabilities`)).json();
  assert.equal(capabilities.node, process.versions.node);
});

test('CLI rejects missing, partial and out-of-range ports before starting a service', async () => {
  for (const args of [['--port'], ['--port', '4242abc'], ['--port', '-1'], ['--port', '65536']]) {
    await assert.rejects(promisify(execFile)(process.execPath, ['bin/agentic-usage-hub.js', ...args]), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Invalid port/);
      return true;
    });
  }
  await assert.rejects(promisify(execFile)(process.execPath, ['bin/agentic-usage-hub.js'], {
    env: { ...process.env, PORT: '4242abc' }
  }), error => error.code === 1 && /PORT/.test(error.stderr));
});

test('HTTP refresh uses partial status when a source fails', async t => {
  t.mock.method(service, 'refreshIndexedSources', async () => ({ success: false, partial: true,
    sources: [{ source: 'ccusage', success: false, lastSuccessfulAt: null, error: 'fixture failure' }] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/refresh`);
  assert.equal(response.status, 207);
  const report = await response.json();
  assert.equal(report.success, false);
  assert.equal(report.sources[0].error, 'fixture failure');
});

test('importing the MCP module does not register HTTP signal handlers', async () => {
  const source = `const before = process.listenerCount('SIGINT'); require('./mcp/server');
    console.log(JSON.stringify({before, after: process.listenerCount('SIGINT'), httpImported: !!require.cache[require.resolve('./unified-server')]}));`;
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', source]);
  const data = JSON.parse(stdout);
  assert.equal(data.before, data.after);
  assert.equal(data.httpImported, false);
});
