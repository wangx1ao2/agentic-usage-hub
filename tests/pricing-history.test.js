'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createPricingHistory } = require('../lib/pricing-history');
const { csvCell } = require('../lib/usage-export');
const directory = path.join(process.env.HOME, 'price-history-fixture');
const record = { id: 'request', source: 'qwen', canonicalModel: 'fixture', inputTokens: 1_000_000,
  cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, totalTokens: 1_000_000,
  costUSD: 1, costBasis: 'catalog-estimate', costComplete: true, unpriced: false, granularity: 'request' };
const catalog = input => ({ fixture: { standard: { in: input, out: input * 2, cache: input / 10 } } });

test('first indexed prices survive a changed catalog and restart; saved versions can be selected explicitly', () => {
  const first = createPricingHistory({ directory, catalog: catalog(1) });
  const original = first.apply([record])[0];
  const oldVersion = original.pricingVersion;
  const updated = createPricingHistory({ directory, catalog: catalog(2) });
  const nextRecord = { ...record, costUSD: 2 };
  assert.equal(updated.apply([nextRecord])[0].costUSD, 1);
  const current = updated.apply([nextRecord], { pricingMode: 'current' })[0];
  assert.equal(current.costUSD, 2);
  assert.equal(current.recordedCostUSD, 1);
  assert.notEqual(current.pricingVersion, oldVersion);
  assert.equal(updated.apply([nextRecord], { pricingMode: 'current', pricingVersion: oldVersion })[0].costUSD, 1);
  assert.equal(updated.metadata().versions.length, 2);
  const restarted = createPricingHistory({ directory, catalog: catalog(2) });
  assert.equal(restarted.apply([nextRecord])[0].costUSD, 1);
  assert.throws(() => restarted.apply([record], { pricingMode: 'current', pricingVersion: 'catalog-' + '0'.repeat(24) }), /Unknown pricing version/);
});

test('recorded log amounts and unknown prices stay distinct from recalculated values', () => {
  const history = createPricingHistory({ directory: path.join(directory, 'reported'), catalog: catalog(2) });
  const reported = { ...record, id: 'reported', costUSD: 9, costBasis: 'reported' };
  assert.equal(history.apply([reported])[0].costUSD, 9);
  assert.equal(history.apply([reported], { pricingMode: 'current' })[0].costUSD, 2);
  const unknown = { ...record, id: 'unknown', canonicalModel: 'missing', costUSD: null, unpriced: true, costComplete: false };
  for (const pricingMode of ['recorded', 'current']) {
    const result = history.apply([unknown], { pricingMode })[0];
    assert.equal(result.costUSD, null);
    assert.equal(result.costComplete, false);
  }
  const cacheWrites = history.apply([{ ...record, id: 'writes', cacheWriteTokens: 50 }], { pricingMode: 'current' })[0];
  assert.equal(cacheWrites.costComplete, false);
});

test('recalculation preserves individual long-context and speed settings rather than applying them to daily totals', () => {
  const history = createPricingHistory({ directory: path.join(directory, 'long'), catalog: {
    'gpt-6.1-sol': { standard: { in: 1, cache: 0.1, out: 2 } }
  } });
  const request = { ...record, id: 'long', source: 'codex', canonicalModel: 'gpt-6.1-sol',
    inputTokens: 300_000, outputTokens: 100_000, pricingContext: { serviceTier: 'fast' } };
  assert.equal(history.apply([request], { pricingMode: 'current' })[0].costUSD, 1.8);
  assert.equal(history.apply([{ ...request, id: 'day', granularity: 'day-model', pricingContext: null }], { pricingMode: 'current' })[0].costUSD, 0.5);
});

test('a corrupt history is preserved and never silently overwritten as a new historical baseline', () => {
  const dir = path.join(directory, 'corrupt'); fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'history.json'); fs.writeFileSync(filename, '{broken history');
  const history = createPricingHistory({ directory: dir, catalog: catalog(2) });
  const result = history.apply([record])[0];
  assert.equal(result.costUSD, 2);
  assert.equal(result.pricingHistoryUnavailable, true);
  assert.equal(history.metadata().readable, false);
  assert.equal(fs.readFileSync(filename, 'utf8'), '{broken history');
});

test('CSV escapes spreadsheet formulas and quoting while keeping numeric measurements numeric', () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell('line\nnext'), '"line\nnext"');
  assert.equal(csvCell(0.25), '0.25');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell('  =SUM(1)'), "'  =SUM(1)");
  assert.equal(csvCell({ inputCharsPerToken: 2.8 }), '"{""inputCharsPerToken"":2.8}"');
  const { exportUsage } = require('../lib/usage-export');
  const csv = exportUsage([{ ...record, estimated: true, estimation: { inputCharsPerToken: 2.8 } }], {}, {}, 'csv');
  assert.match(csv.body, /estimated,costEstimated,estimation,pricingContext/);
  assert.match(csv.body, /inputCharsPerToken/);
});

test('independent HTTP/MCP history instances merge their captures and keep the first committed record price', () => {
  const dir = path.join(directory, 'instances');
  const first = createPricingHistory({ directory: dir, catalog: catalog(1) });
  const second = createPricingHistory({ directory: dir, catalog: catalog(2) });
  first.apply([record]);
  const merged = second.apply([{ ...record, costUSD: null,unpriced:true,costBasis:'unpriced',costComplete:false }, { ...record, id: 'another', costUSD: 2 }])[0];
  assert.equal(merged.costUSD, 1);
  assert.equal(merged.costBasis,'catalog-estimate');
  assert.equal(merged.unpriced,false);
  const restarted = createPricingHistory({ directory: dir, catalog: catalog(2) });
  assert.equal(restarted.apply([record])[0].costUSD, 1);
  assert.equal(restarted.apply([{ ...record, id: 'another', costUSD: 2 }])[0].costUSD, 2);
  assert.equal(restarted.metadata().versions.length, 2);
});

test('a live writer lock is retained and a later retry persists the in-memory capture', () => {
  const dir = path.join(directory, 'writer'); fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'history.lock');
  fs.writeFileSync(filename, JSON.stringify({ pid: process.pid, threadId: 0 }));
  const history = createPricingHistory({ directory: dir, catalog: catalog(1) });
  history.apply([record]);
  assert.ok(history.metadata().error);
  assert.equal(fs.existsSync(filename), true);
  fs.unlinkSync(filename);
  history.apply([record]);
  assert.equal(history.metadata().error, null);
  assert.equal(fs.existsSync(path.join(dir, 'history.json')), true);
});
