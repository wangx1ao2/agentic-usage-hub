const test = require('node:test');
const assert = require('node:assert/strict');
const { MODEL_CATALOG, resolveModelInfo, calculateModelCost } = require('../models-pricing');
const { calculateCost } = require('../zcode-adapter');

test('current standard rates and provider aliases', () => {
  const expected = {
    'gpt-6.1-terra': [1, 0.05, 5],
    'gpt-5.6-sol': [4, 0.4, 20],
    'claude-fable-5': [10, 1, 50],
    'claude-fable-5-1': [10, 0.25, 50],
    'claude-opus-5-5': [4, 0.2, 20],
    'claude-sonnet-5-5': [2, 0.1, 10],
    'claude-haiku-5-5': [0.1, 0.01, 0.5],
    'grok-4.6': [2, 0.5, 6],
    'Gemini 3.7 Flash': [0.75, 0.075, 3.75],
    'deepseek-flash': [0.3, 0.006, 1.2],
    'GLM-5.3': [1.4, 0.26, 4.4],
    'qwen3.8-max': [12 / 7.15, null, 36 / 7.15]
  };
  for (const [id, [input, cached, output]] of Object.entries(expected)) {
    assert.deepEqual(MODEL_CATALOG[id].standard, { in: input, cache: cached, out: output }, id);
  }
  assert.equal(resolveModelInfo('gpt-5.6').canonicalName, 'gpt-5.6-sol');
  assert.equal(resolveModelInfo('openai/gpt-6.1-terra-20261026').canonicalName, 'gpt-6.1-terra');
  assert.equal(calculateModelCost('gpt-6.1-terra', 1_000_000, 100_000, 200_000), 1.31);
  assert.equal(resolveModelInfo('claude-opus-4-8').canonicalName, 'claude-opus-4-8');
  assert.equal(resolveModelInfo('gemini-3.7-flash').canonicalName, 'Gemini 3.7 Flash');
  assert.equal(resolveModelInfo('deepseek-v4-flash').canonicalName, 'deepseek-flash');
  assert.equal(resolveModelInfo('qwen3.8-27b').canonicalName, 'qwen3.8-27b');
});

test('adapters use catalog prices and unfamiliar revisions remain unpriced', () => {
  assert.equal(calculateCost('gpt-5.6-sol', 1_000_000, 100_000, 200_000), 5.28);
  assert.equal(calculateModelCost('Gemini 3.7 Flash', 1_000_000, 100_000, 200_000), 0.99);
  for (const id of ['gpt-6.2-sol', 'grok-4.8', 'grok-4.6-mini', 'gemini-3.9-flash', 'GLM-5.4', 'claude-fable-5-2']) {
    assert.equal(resolveModelInfo(id).unpriced, true, id);
    assert.equal(calculateModelCost(id, 1_000_000, 100_000), 0, id);
  }
});
