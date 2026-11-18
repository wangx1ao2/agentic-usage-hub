'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');

function loadCache({ explicitCache = false, current = null, legacyVersion = 2, includeData = false } = {}) {
  const source = `
    const fs = require('node:fs'), path = require('node:path');
    const config = require('./lib/config');
    const currentPath = path.join(config.cacheDir, 'ccusage-cache.json');
    const legacyPath = path.resolve('.cache/ccusage-cache.json');
    const read = fs.readFileSync;
    fs.readFileSync = function(filename, ...args) {
      if (filename === currentPath) {
        if (${JSON.stringify(current)} !== null) return JSON.stringify(${JSON.stringify(current)});
        throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' });
      }
      if (filename === legacyPath) return JSON.stringify({
        _sourceSelectionVersion: ${legacyVersion}, _codexInputVersion: 3,
        daily: [{ date: '2026-06-22', totalCost: 2000 }]
      });
      return read.call(this, filename, ...args);
    };
    ${explicitCache ? '' : 'delete process.env.AGENTIC_CACHE_DIR;'}
    const loader = require('./lib/codex-loader');
    loader.stop();
    console.log(JSON.stringify(${includeData ? '{ status: loader.getStatus(), data: loader.getCodexDataSync() }' : 'loader.getStatus()'}));
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' }));
}

test('cache directory migration retains the legacy history as stale until a complete rebuild', () => {
  const status = loadCache();
  assert.equal(status.available, true);
  assert.equal(status.stale, true);
  assert.equal(status.lastSuccessfulAt, null);
});

test('an explicitly isolated cache never imports project history and incompatible snapshots are rejected', () => {
  assert.equal(loadCache({ explicitCache: true }).available, false);
  assert.equal(loadCache({ legacyVersion: 1 }).available, false);
  assert.equal(loadCache({ explicitCache: true, current: { _sourceSelectionVersion: 2, daily: [] } }).available, true);
});

test('a dashboard cannot publish an incomplete subtotal before Codex history becomes available', async () => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    const service = require(${JSON.stringify(require.resolve('../lib/usage-service'))});
    service.codexLoader.ensureFresh = async () => {};
    service.codexLoader.getStatus = () => ({ available: false });
    service.queryDashboard().then(() => parentPort.postMessage({ published: true }),
      error => parentPort.postMessage({ statusCode: error.statusCode }));
  `, { eval: true });
  try {
    const result = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    assert.equal(result.statusCode, 503);
    assert.equal(result.published, undefined);
  } finally { await worker.terminate(); }
});

test('persisted reviewer fallback is corrected before the first dashboard read', () => {
  const timestamp = Date.parse('2026-10-28T04:30:00Z');
  const { status, data } = loadCache({ explicitCache: true, includeData: true, current: {
    _sourceSelectionVersion: 2, _sourceReadAt: Date.now(),
    daily: [{ date: '2026-10-28', totalTokens: 310, modelBreakdowns: [
      { agent: 'codex', modelName: 'gpt-5.5', inputTokens: 100, cacheReadTokens: 200, outputTokens: 10, cost: 99 }
    ] }],
    quotaSnapshots: [], requestRecords: [{ key: 'reviewer', sessionId: 'guardian', model: 'codex-auto-review',
      timestamp, date: '2026-10-28', inputTokens: 100, cacheReadTokens: 200, outputTokens: 10,
      cost: 0, standardCost: 0, unpriced: true }]
  } });
  assert.equal(status.available, true);
  assert.equal(status.stale, true);
  assert.equal(data.daily[0].modelBreakdowns[0].modelName, 'codex-auto-review');
  assert.equal(data.daily[0].modelBreakdowns[0].cost, 0.00032);
  assert.equal(data.daily[0].modelBreakdowns[0].unpriced, false);
  assert.equal(data.requestRecords[0].pricingContext.assumedRateModel, 'gpt-6.1-sol');
});
