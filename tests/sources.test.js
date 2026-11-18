const test = require('node:test');
const assert = require('node:assert/strict');
const { selectUsageSources } = require('../lib/codex-loader');
const { canonicalizeProject } = require('../project-adapter');
const { resolveModelInfo } = require('../models-pricing');
const { getCcusageBreakdownCost } = require('../unified-server');

test('ccusage source selection excludes agents handled by local adapters', () => {
  const row = (agent, modelName, totalTokens) => ({
    agent, totalTokens, inputTokens: totalTokens, outputTokens: 0,
    cacheReadTokens: 0, totalCost: totalTokens / 1000,
    modelBreakdowns: [{ modelName, totalTokens, inputTokens: totalTokens, cost: totalTokens / 1000 }],
    modelsUsed: [modelName]
  });
  const selected = selectUsageSources({ daily: [{
    period: '2026-10-08',
    agents: [
      row('codex', 'gpt-5.6-sol', 100),
      row('claude', 'claude-4.5-sonnet', 200),
      row('qwen', 'qwen-plus', 300),
      row('openclaw', 'deepseek-chat', 400)
    ]
  }] });
  assert.equal(selected.daily.length, 1);
  assert.equal(selected.daily[0].totalTokens, 300);
  assert.deepEqual(selected.daily[0].modelBreakdowns.map(m => m.agent), ['codex', 'claude']);
  assert.equal(selected._sourceSelectionMode, 'selected-agents');
  assert.equal(selectUsageSources({ daily: [{ period: '2026-10-08', agent: 'all' }] }), null);
  assert.equal(selectUsageSources({ daily: [{ period: '2026-10-08', totalTokens: 10 }] }, true)._sourceSelectionMode, 'codex-only-fallback');
});

test('project identity uses full normalized path instead of a keyword or basename', () => {
  const first = canonicalizeProject('C:\\work\\team-a\\token');
  const same = canonicalizeProject('c:/work/team-a/token/');
  const other = canonicalizeProject('C:\\work\\team-b\\token');
  assert.equal(first.key, same.key);
  assert.notEqual(first.key, other.key);
  assert.equal(first.name, 'token');
  assert.equal(other.name, 'token');
});

test('Codex fallback preserves native costUSD and model attribution', () => {
  const selected = selectUsageSources({ daily: [{ date: '2026-06-22', costUSD: 12,
    inputTokens: 100, cacheReadTokens: 200, outputTokens: 50, totalTokens: 350,
    models: { 'gpt-5.5': { inputTokens: 100, cacheReadTokens: 200, outputTokens: 50, totalTokens: 350 } }
  }] }, true);
  assert.equal(selected.daily[0].totalCost, 12);
  assert.equal(selected.daily[0].totalTokens, 350);
  assert.deepEqual(selected.daily[0].modelsUsed, ['gpt-5.5']);
  assert.equal(selected.daily[0].models['gpt-5.5'].totalTokens, 350);
});

test('missing GPT-6 Sol ccusage price uses separate fresh and cached input rates', () => {
  assert.equal(resolveModelInfo('gpt-6-sol').canonicalName, 'gpt-6-sol');
  assert.equal(resolveModelInfo('gpt-6.0').unpriced, true);
  const usage = { inputTokens: 1_000_000, cacheReadTokens: 2_000_000, outputTokens: 500_000, cost: 0 };
  const amount = getCcusageBreakdownCost('gpt-6-sol', usage);
  assert.deepEqual(amount, { cost: 7.4, estimated: true, unpriced: false });
  assert.deepEqual(getCcusageBreakdownCost('gpt-6.0', usage), { cost: 0, estimated: false, unpriced: true });
  assert.deepEqual(getCcusageBreakdownCost('gpt-6-sol', { ...usage, cost: 8 }), { cost: 8, estimated: false, unpriced: false });
});
