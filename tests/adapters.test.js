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

  await t.test('7. Models Pricing: calculates Claude 3.7 Sonnet accurately with cache', () => {
    const { calculateModelCost, resolveModelInfo } = require('../models-pricing');
    const info = resolveModelInfo('anthropic/claude-3-7-sonnet-20250219');
    assert.equal(info.canonicalName, 'claude-3-7-sonnet');
    assert.equal(info.company, 'Anthropic');
    assert.equal(info.agent, 'claude');

    // 1M in (200k cache, 800k fresh), 500k out
    // 0.8M * $3 + 0.2M * $0.30 + 0.5M * $15 = 2.40 + 0.06 + 7.50 = 9.96
    const cost = calculateModelCost('claude-3-7-sonnet', 1_000_000, 500_000, 200_000);
    assert.equal(+cost.toFixed(2), 9.96);
  });

  await t.test('8. Models Pricing: calculates Grok 3 and Grok 2 accurately', () => {
    const { calculateModelCost, resolveModelInfo } = require('../models-pricing');
    const grok3Info = resolveModelInfo('xai/grok-3');
    assert.equal(grok3Info.company, 'xAI');
    assert.equal(grok3Info.agent, 'grok');

    // Grok 3: in $3, out $15, cache $0.75
    // 800k * $3 + 200k * $0.75 + 500k * $15 = 2.40 + 0.15 + 7.50 = 10.05
    const grok3Cost = calculateModelCost('grok-3', 1_000_000, 500_000, 200_000);
    assert.equal(+grok3Cost.toFixed(2), 10.05);

    // Grok 2: in $2, out $10, cache $0.20
    const grok2Cost = calculateModelCost('grok-2', 1_000_000, 200_000, 0);
    assert.equal(+grok2Cost.toFixed(2), 4.00);
  });

  await t.test('9. Models Pricing: fuzzy matches various model identifiers', () => {
    const { resolveModelInfo } = require('../models-pricing');
    assert.equal(resolveModelInfo('claude-3-5-sonnet-20241022').company, 'Anthropic');
    assert.equal(resolveModelInfo('grok-2-1212').company, 'xAI');
    assert.equal(resolveModelInfo('deepseek-reasoner').company, 'DeepSeek');
    assert.equal(resolveModelInfo('qwen-2.5-coder-32b').company, 'Qwen (通义千问)');
    assert.equal(resolveModelInfo('mistral-large').company, 'Other / OpenSource');
  });

  await t.test('10. Project Adapter includes multi-vendor company attributes', () => {
    const projects = projectAdapter.getProjectAttributionList();
    assert.ok(Array.isArray(projects));
    if (projects.length > 0) {
      const p = projects[0];
      assert.ok(p.companies.anthropic, 'companies.anthropic must exist');
      assert.ok(p.companies.xai, 'companies.xai must exist');
      assert.ok(typeof p.companies.anthropic.cost === 'number');
      assert.ok(typeof p.companies.xai.cost === 'number');
    }
  });

  await t.test('11. Models Pricing: resolves and calculates Claude Fable 5 and Claude 4.5 accurately', () => {
    const { calculateModelCost, resolveModelInfo } = require('../models-pricing');
    const fableInfo = resolveModelInfo('anthropic/claude-fable-5-preview');
    assert.equal(fableInfo.canonicalName, 'claude-fable-5');
    assert.equal(fableInfo.company, 'Anthropic');
    assert.equal(fableInfo.agent, 'claude');
    assert.equal(fableInfo.pricing.in, 5.00);
    assert.equal(fableInfo.pricing.out, 25.00);

    // 1M fresh in ($5), 500k out ($12.50), 200k cache ($0.10)
    // 0.8M * 5 + 0.2M * 0.50 + 0.5M * 25 = 4.00 + 0.10 + 12.50 = 16.60
    const cost = calculateModelCost('claude-fable-5', 1_000_000, 500_000, 200_000);
    assert.equal(+cost.toFixed(2), 16.60);

    const c45Info = resolveModelInfo('claude-4.5-sonnet');
    assert.equal(c45Info.company, 'Anthropic');
    assert.equal(c45Info.pricing.in, 3.50);
  });

  await t.test('12. Models Pricing: resolves and calculates Grok 4.6 accurately', () => {
    const { calculateModelCost, resolveModelInfo } = require('../models-pricing');
    const grok46Info = resolveModelInfo('xai/grok-4.6');
    assert.equal(grok46Info.canonicalName, 'grok-4.6');
    assert.equal(grok46Info.company, 'xAI');
    assert.equal(grok46Info.pricing.in, 4.00);
    assert.equal(grok46Info.pricing.out, 20.00);

    // 1M in (200k cache, 800k fresh), 500k out
    // 0.8M * 4 + 0.2M * 0.80 + 0.5M * 20 = 3.20 + 0.16 + 10.00 = 13.36
    const cost = calculateModelCost('grok-4.6', 1_000_000, 500_000, 200_000);
    assert.equal(+cost.toFixed(2), 13.36);

    const grok4Info = resolveModelInfo('grok-4');
    assert.equal(grok4Info.company, 'xAI');
    assert.equal(grok4Info.pricing.in, 3.50);
  });
});
