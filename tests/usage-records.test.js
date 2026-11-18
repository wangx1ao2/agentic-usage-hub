'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDaily } = require('../lib/usage-record');
const { aggregateRecords } = require('../lib/usage-aggregate');
const { normalizeCcusageDaily } = require('../lib/ccusage-normalize');
const { getRuntimeCapabilities } = require('../lib/runtime-capabilities');
const date = '2026-10-18';

test('fresh input, cached input and output have one explicit representation', () => {
  const [record] = normalizeDaily([{ date, modelBreakdowns: [{ modelName: 'qwen-plus',
    inputTokens: 100, cacheReadTokens: 80, outputTokens: 20, totalTokens: 120, cost: 1 }] }], 'qwen');
  assert.equal(record.inputTokens, 20);
  assert.equal(record.inputTokens + record.cacheReadTokens + record.outputTokens, record.totalTokens);
  assert.equal(record.timestamp, null, 'Daily aggregates must not fabricate request timestamps');
  assert.equal(record.granularity, 'day-model');
});

test('unknown price stays unknown while measured token totals remain included', () => {
  const [record] = normalizeDaily([{ date, modelName: 'gpt-unknown-2028', totalTokens: 120, inputTokens: 120, totalCost: 0 }], 'codex');
  assert.equal(record.costUSD, null);
  assert.equal(record.costBasis, 'unpriced');
  const result = aggregateRecords([record], { today: date });
  assert.equal(result.totals.totalTokens, 120);
  assert.equal(result.totals.unpricedTokens, 120);
  assert.equal(result.totals.costComplete, false);
});

test('record identity makes repeated ingestion idempotent and actual-only excludes estimates everywhere', () => {
  const actual = normalizeDaily([{ date, modelName: 'qwen-plus', inputTokens: 100, totalTokens: 100, totalCost: 1 }], 'qwen');
  const estimated = normalizeDaily([{ date, modelName: 'Gemini 3.7 Flash', inputTokens: 300, totalTokens: 300, totalCost: 3 }], 'antigravity', { estimated: true });
  const result = aggregateRecords([...actual, ...actual, ...estimated], { today: date });
  assert.equal(result.totals.totalTokens, 400);
  assert.equal(result.totals.estimatedShare, 0.75);
  const filtered = aggregateRecords([...actual, ...estimated], { today: date, actualOnly: true });
  assert.equal(filtered.totals.totalTokens, 100);
  assert.equal(filtered.today.totalTokens, 100);
  assert.equal(filtered.models.length, 1);
  assert.equal(filtered.agentBreakdown.antigravity.totalTokens, 0);
});

test('unallocated model lists conserve measured totals without inventing model shares', () => {
  const days = normalizeCcusageDaily({ daily: [{ date, modelsUsed: ['model-a', 'model-b', 'model-c'],
    inputTokens: 5, totalTokens: 5, totalCost: 0.01 }] });
  assert.equal(days[0].modelBreakdowns.length, 1);
  assert.equal(days[0].modelBreakdowns[0].modelName, 'unknown (unallocated)');
  assert.equal(days[0].modelBreakdowns[0].totalTokens, 5);
  assert.equal(days[0].totalCost, 0.01);
});

test('capability status reflects this runtime instead of inferring features from the major version', () => {
  const capabilities = getRuntimeCapabilities();
  assert.equal(capabilities.node, process.versions.node);
  assert.equal(capabilities.zstandard, typeof require('node:zlib').createZstdDecompress === 'function');
  assert.equal(capabilities.complete, capabilities.sqlite && capabilities.zstandard);
});

test('workspace identity normalizes Windows drive/UNC prefixes and rejects relative or device paths', () => {
  const { canonicalWorkspacePath: canonical } = require('../lib/project-path');
  assert.equal(canonical('\\\\?\\C:\\Team\\Alpha\\'), canonical('c:/team/alpha'));
  assert.equal(canonical('\\\\?\\UNC\\Server\\Share\\Alpha'), canonical('\\\\server\\share\\alpha'));
  for (const value of ['relative/path', 'C:relative', '\\\\.\\pipe\\named', null]) assert.equal(canonical(value), null);
  assert.notEqual(canonical('/team/Alpha'), canonical('/team/alpha'));
});

test('date-only evidence stays at day precision and source estimates disclose inferred dates', () => {
  const { parseQoder, parseAntigravity, parseUsageLog } = require('../lib/log-parsers');
  const qoder = parseQoder(JSON.stringify({ type: 'assistant', message: { id: 'one', content: 'x'.repeat(320) } }),
    '/logs/chat.jsonl', { mtimeMs: Date.parse('2026-10-18T04:00:00Z') });
  assert.equal(qoder.undatedRecords, 1);
  assert.equal(qoder.records[0].timestamp, null);
  assert.equal(qoder.records[0].date, date);
  assert.equal(qoder.records[0].dateBasis, 'file-modification-estimate');
  const agy = parseAntigravity(JSON.stringify({ timestamp: '2026-10-18T04:00:00Z', content: 'one' }) + '\n'
    + JSON.stringify({ content: 'two' }), '/brain/session/conversations/a/transcript.jsonl');
  assert.equal(agy.undatedRecords, 1);
  assert.equal(agy.records[1].timestamp, null);
  assert.equal(agy.records[1].dateBasis, 'inherited-session-date-estimate');
  assert.equal(parseAntigravity('{"content":"no date"}', '/logs/transcript.jsonl').records.length, 0);
  const logged = parseUsageLog('qwen', JSON.stringify({ date, model: 'qwen-plus', promptTokens: 100 }), '/logs/usage.jsonl');
  assert.equal(logged.records[0].dateBasis, 'logged-day');
  assert.equal(logged.records[0].granularity, 'day-model');
});

test('model names that coincide with object prototypes remain unpriced data keys', () => {
  for (const model of ['__proto__', 'constructor', 'toString']) {
    const records = normalizeDaily([{ date, modelName: model, inputTokens: 10, totalTokens: 10 }], 'codex');
    const result = aggregateRecords(records);
    assert.equal(result.models[0].modelName, model);
    assert.equal(result.totals.unpricedTokens, 10);
  }
});

test('ccusage catalog estimates retain separate cache-write components without fabricating model names', () => {
  const [record] = normalizeDaily(normalizeCcusageDaily({ daily: [{ date, modelBreakdowns: [{ agent: 'claude',
    inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 30, outputTokens: 40, cost: 1 }] }] }), 'ccusage', { freshInput: true });
  assert.equal(record.model, 'unknown (unallocated)');
  assert.equal(record.totalTokens, 100);
  assert.equal(record.cacheWriteTokens, 30);
  assert.equal(record.costBasis, 'catalog-estimate');
  assert.equal(record.costEstimated, true);
});
