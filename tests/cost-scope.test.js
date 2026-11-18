const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDashboardData } = require('../unified-server');
const { getLocalDateStr } = require('../lib/date');

test('file-based image estimates never inflate logged cost or token totals', t => {
  const date = getLocalDateStr();
  const raw = { daily: [{ date, inputTokens: 100, cacheReadTokens: 200,
    outputTokens: 50, totalTokens: 350, modelBreakdowns: [{
      modelName: 'gpt-6.1-sol', agent: 'codex', inputTokens: 100,
      cacheReadTokens: 200, outputTokens: 50, totalTokens: 350,
      cost: 0, requestPricing: { cost: 42 }
    }] }] };
  const images = { model: 'GPT-Image-2', costBasis: 'file-count-reference',
    usageAvailable: false, includedInTotals: false,
    totals: { totalCount: 472, totalCost: 25.02, totalTokens: 9_440_000 },
    daily: [{ date, count: 472, cost: 25.02, tokens: 9_440_000 }], recentImages: [] };
  t.mock.method(require('../lib/codex-loader'), 'getCodexDataSync', () => raw);
  t.mock.method(require('../codex-image-adapter'), 'getCodexImageAnalysis', () => images);
  for (const [module, method] of [
    ['zcode-adapter', 'getZCodeDaily'], ['antigravity-adapter', 'getAntigravityDaily'],
    ['openclaw-adapter', 'getOpenClawAndReasonixDaily'], ['qwen-adapter', 'getQwenDaily'],
    ['qoderwork-adapter', 'getQoderDaily'], ['project-adapter', 'getProjectAttributionList']
  ]) t.mock.method(require(`../${module}`), method, () => []);

  const data = buildDashboardData();
  assert.equal(data.todaySummary.totalCost, 42);
  assert.equal(data.totals.totalCostUSD, 42);
  assert.equal(data.totals.thisMonthCost, 42);
  assert.equal(data.todaySummary.thisMonthCost, 42);
  assert.equal(data.totals.totalTokens, 350);
  assert.equal(data.agentBreakdown.codex.totalCost, 42);
  assert.equal(data.agentBreakdown.codex.totalTokens, 350);
  assert.equal(data.modelFamilies[0].totalCost, 42);
  assert.equal(data.modelFamilies[0].totalTokens, 350);
  assert.equal(data.modelFamilies[0].subModels.find(m => m.isImageGen).includedInTotals, false);
  assert.equal(data.todaySummary.images.cost, 25.02);
  assert.equal(data.todaySummary.images.includedInTotals, false);
  assert.equal(data.todaySummary.images.usageAvailable, false);
  assert.equal(data.todaySummary.images.costBasis, 'file-count-reference');

  // A provider filter must not pull unrelated image estimates into totals.
  const filtered = buildDashboardData('standard', 'claude');
  assert.equal(filtered.totals.totalCostUSD, 0);
  assert.equal(filtered.totals.totalTokens, 0);
  assert.equal(filtered.todaySummary.totalCost, 42);
  assert.equal(filtered.modelFamilies.length, 0);

  raw.daily = [];
  const imageOnly = buildDashboardData();
  assert.equal(imageOnly.totals.totalCostUSD, 0);
  assert.equal(imageOnly.totals.totalTokens, 0);
  assert.equal(imageOnly.todaySummary.images.count, 472);
  assert.equal(imageOnly.agentBreakdown.codex.totalCost, 0);
});
