const test = require('node:test');
const assert = require('node:assert/strict');

const zcode = require('../zcode-adapter');
const projectAdapter = require('../project-adapter');
const codexImage = require('../codex-image-adapter');
const antigravity = require('../antigravity-adapter');
const openclaw = require('../openclaw-adapter');

test('Adapters & Calculations Unit Tests', async (t) => {

  await t.test('1. ZCode calculateCost: verifies standard vs flagship tier pricing', () => {
    // 1M fresh input, 500k output, 500k cache
    const costStandard = zcode.calculateCost('GLM-5.3-Flash', 1_000_000, 500_000, 500_000, 'standard');
    const costFlagship = zcode.calculateCost('GLM-5.3-Flash', 1_000_000, 500_000, 500_000, 'flagship');

    // Standard for GLM-5.3-Flash: in $0.15/1M, out $0.50/1M, cache $0.03/1M
    // fresh = 1M - 500k = 500k = 0.5M * 0.15 = $0.075
    // cache = 0.5M * 0.03 = $0.015
    // out = 0.5M * 0.50 = $0.25
    // Total = 0.075 + 0.015 + 0.25 = $0.34
    assert.equal(+costStandard.toFixed(4), 0.34);

    // Flagship tier should be higher than standard
    assert.ok(costFlagship > costStandard, 'Flagship cost should be higher than standard');
  });

  await t.test('2. ZCode getZCodeDaily returns array with valid period schema', () => {
    const daily = zcode.getZCodeDaily('standard');
    assert.ok(Array.isArray(daily), 'daily should be an array');
    if (daily.length > 0) {
      const item = daily[0];
      assert.ok(item.date, 'Item must have date');
      assert.equal(item.agent, 'zcode');
      assert.ok(typeof item.totalCost === 'number', 'totalCost should be number');
      assert.ok(typeof item.totalTokens === 'number', 'totalTokens should be number');
      assert.ok(Array.isArray(item.modelBreakdowns), 'modelBreakdowns must be array');
    }
  });

  await t.test('3. Project Adapter returns sorted projects with percentage distributions', () => {
    const projects = projectAdapter.getProjectAttributionList();
    assert.ok(Array.isArray(projects), 'projects should be an array');
    if (projects.length > 0) {
      const p = projects[0];
      assert.ok(p.id, 'id is required');
      assert.ok(p.name, 'name is required');
      assert.ok(p.companies, 'companies object is required');
      assert.ok(p.companies.openai, 'companies.openai is required');
      assert.ok(typeof p.companies.openai.percent === 'number');

      // Check sorting descending by totalCost
      for (let i = 1; i < projects.length; i++) {
        assert.ok(projects[i - 1].totalCost >= projects[i].totalCost, 'Projects must be sorted descending by cost');
      }
    }
  });

  await t.test('4. Codex Image Adapter returns valid totals and daily timeline', () => {
    const imgData = codexImage.getCodexImageAnalysis();
    assert.ok(imgData.totals, 'totals must exist');
    assert.ok(typeof imgData.totals.totalCount === 'number');
    assert.ok(typeof imgData.totals.totalCost === 'number');
    assert.ok(typeof imgData.totals.totalTokens === 'number');
    assert.ok(Array.isArray(imgData.daily), 'daily timeline must be array');
    assert.ok(Array.isArray(imgData.recentImages), 'recentImages must be array');
  });

  await t.test('5. Antigravity Adapter returns daily usage records', () => {
    const agyDaily = antigravity.getAntigravityDaily();
    assert.ok(Array.isArray(agyDaily), 'agyDaily must be an array');
    if (agyDaily.length > 0) {
      const item = agyDaily[0];
      assert.ok(item.date);
      assert.equal(item.agent, 'antigravity');
      assert.equal(item.company, 'Google (Gemini)');
      assert.ok(typeof item.totalTokens === 'number');
      assert.ok(typeof item.totalCost === 'number');
    }
  });

  await t.test('6. OpenClaw Adapter parses DeepSeek usage properly', () => {
    const openDaily = openclaw.getOpenClawAndReasonixDaily();
    assert.ok(Array.isArray(openDaily), 'openDaily must be an array');
    if (openDaily.length > 0) {
      const item = openDaily[0];
      assert.ok(item.date);
      assert.ok(item.modelsUsed.length > 0);
      assert.ok(typeof item.totalTokens === 'number');
      assert.ok(typeof item.totalCost === 'number');
    }
  });
});
