const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../unified-server');

const BASE_URL = 'http://localhost:4242';

test('API Test Suite - Agentic Usage Hub', async (t) => {
  let serverInstance = null;

  // Ensure server is listening before tests
  try {
    await fetch(`${BASE_URL}/`);
  } catch (e) {
    await new Promise(resolve => {
      serverInstance = server.listen(4242, resolve);
    });
  }

  t.after(() => {
    if (serverInstance) serverInstance.close();
  });

  await t.test('1. GET /api/dashboard returns complete valid schema', async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard?tier=standard&agent=all`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);

    const data = await res.json();
    assert.ok(data.meta, 'meta should exist');
    assert.ok(data.totals, 'totals should exist');
    assert.ok(Array.isArray(data.timeline), 'timeline should be an array');
    assert.ok(Array.isArray(data.models), 'models should be an array');
    assert.ok(Array.isArray(data.companies), 'companies should be an array');
    assert.ok(data.todaySummary, 'todaySummary must exist');
    assert.ok(data.todaySummary.byModel, 'todaySummary.byModel must exist');
    assert.ok(data.imageAnalysis, 'imageAnalysis must exist');
    assert.ok(Array.isArray(data.projects), 'projects should be an array');

    // Validate todaySummary.byModel structure. Assertions on specific models
    // would be environment-coupled: CI runners have no local agent logs, so
    // presence depends entirely on the local machine's usage that day.
    const todayModels = Object.entries(data.todaySummary.byModel);
    for (const [model, entry] of todayModels) {
      assert.ok(model.length > 0, 'Model name must be non-empty');
      assert.equal(typeof entry.cost, 'number', `cost for ${model} must be numeric`);
      assert.equal(typeof entry.tokens, 'number', `tokens for ${model} must be numeric`);
      assert.equal(typeof entry.agent, 'string', `agent for ${model} must be a string`);
      assert.equal(typeof entry.company, 'string', `company for ${model} must be a string`);
    }
    // Every model active today must also appear in the unfiltered timeline
    const timelineToday = data.timeline.find(d => d.date === data.meta.today);
    assert.ok(timelineToday, 'Today must always exist in timeline');
    for (const model of Object.keys(data.todaySummary.byModel)) {
      assert.ok(timelineToday.byModel[model], `Timeline today should include ${model}`);
    }

    // Verify companies array contains all 6 core companies
    const compNames = data.companies.map(c => c.name);
    ['OpenAI', 'Anthropic', 'xAI', 'Google (Gemini)', '智谱 AI (Z.ai)', 'DeepSeek'].forEach(c => {
      assert.ok(compNames.includes(c), `Company ${c} must be in companies list`);
    });
  });

  await t.test('2. GET /api/dashboard handles invalid tier and agent gracefully', async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard?tier=INVALID_TIER_123&agent=UNKNOWN_AGENT_XYZ`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.meta.pricingTier, 'standard', 'Invalid tier should fallback to standard');
    assert.equal(data.meta.agentFilter, 'all', 'Invalid agent should fallback to all');
  });

  await t.test('3. GET /api/dashboard with agent=antigravity keeps todaySummary complete', async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard?tier=standard&agent=antigravity`);
    assert.equal(res.status, 200);
    const data = await res.json();

    // Timeline is filtered to antigravity (today entry always exists even
    // when the agent has no usage yet, via the calendar-day backfill)
    assert.equal(data.meta.agentFilter, 'antigravity');
    const todayInTimeline = data.timeline.find(d => d.date === data.meta.today);
    assert.ok(todayInTimeline, 'Today should exist in timeline');

    // BUT todaySummary remains comprehensive across all agents! Check the
    // invariant without naming specific models: any model the agent filter
    // left in today's timeline must still be present in todaySummary.
    for (const model of Object.keys(todayInTimeline.byModel)) {
      assert.ok(data.todaySummary.byModel[model],
        `todaySummary should retain ${model} even when filtered`);
    }
  });

  await t.test('4. GET /api/projects returns valid attribution list', async () => {
    const res = await fetch(`${BASE_URL}/api/projects`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.projects), 'projects should be an array');
    assert.equal(data.totalCount, data.projects.length);
    if (data.projects.length > 0) {
      const p = data.projects[0];
      assert.ok(p.id, 'Project must have id');
      assert.ok(p.name, 'Project must have name');
      assert.ok(typeof p.totalTokens === 'number', 'Project must have numeric totalTokens');
      assert.ok(typeof p.totalCost === 'number', 'Project must have numeric totalCost');
    }
  });

  await t.test('5. GET /api/refresh invalidates and refreshes successfully', async () => {
    const res = await fetch(`${BASE_URL}/api/refresh`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.timestamp > 0);
  });

  await t.test('6. OPTIONS /api/dashboard returns 204 No Content for CORS preflight', async () => {
    const res = await fetch(`${BASE_URL}/api/dashboard`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
  });

  await t.test('7. Static file serving returns correct headers and SPA fallback', async () => {
    const resHtml = await fetch(`${BASE_URL}/`);
    assert.equal(resHtml.status, 200);
    assert.match(resHtml.headers.get('content-type'), /text\/html/);

    const resCss = await fetch(`${BASE_URL}/styles.css`);
    assert.equal(resCss.status, 200);
    assert.match(resCss.headers.get('content-type'), /text\/css/);

    const resJs = await fetch(`${BASE_URL}/app.js`);
    assert.equal(resJs.status, 200);
    assert.match(resJs.headers.get('content-type'), /application\/javascript/);
  });

  await t.test('8. Security - Path traversal attack prevention on static files', async () => {
    const res = await fetch(`${BASE_URL}/../../package.json`);
    assert.ok(res.status === 403 || res.status === 200 && !res.headers.get('content-type').includes('json'));
  });

  await t.test('9. Security - Path traversal prevention on /api/codex-image', async () => {
    // Missing path param
    const resMissing = await fetch(`${BASE_URL}/api/codex-image`);
    assert.equal(resMissing.status, 400);

    // Traversal attempting to read outside image directory
    const resAttack1 = await fetch(`${BASE_URL}/api/codex-image?path=../../../../windows/system32/cmd.exe`);
    assert.equal(resAttack1.status, 404);

    // Non-image extension inside valid directory
    const resAttack2 = await fetch(`${BASE_URL}/api/codex-image?path=${encodeURIComponent(require('path').join(require('os').homedir(), '.codex', 'generated_images', 'evil.bat'))}`);
    assert.equal(resAttack2.status, 404);
  });

  await t.test('10. GET /api/models-pricing returns comprehensive catalog', async () => {
    const res = await fetch(`${BASE_URL}/api/models-pricing`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(data.companies, 'companies map must exist');
    assert.ok(data.companies.Anthropic, 'Anthropic company config must exist');
    assert.ok(data.companies.xAI, 'xAI company config must exist');
    assert.ok(data.models['claude-fable-5'], 'Claude Fable 5 must be cataloged');
    assert.ok(data.models['grok-4.6'], 'Grok 4.6 must be cataloged');
    assert.ok(data.models['claude-3-7-sonnet'], 'Claude 3.7 Sonnet must be cataloged');
    assert.ok(data.models['grok-3'], 'Grok 3 must be cataloged');
    assert.equal(data.models['claude-fable-5'].standard.in, 5.00);
    assert.equal(data.models['grok-4.6'].standard.in, 4.00);
    assert.equal(data.models['claude-3-7-sonnet'].standard.in, 3.00);
    assert.equal(data.models['grok-3'].standard.in, 3.00);
  });

  await t.test('11. GET /api/dashboard supports agent=claude and agent=grok filters', async () => {
    const resClaude = await fetch(`${BASE_URL}/api/dashboard?agent=claude`);
    assert.equal(resClaude.status, 200);
    const dataClaude = await resClaude.json();
    assert.equal(dataClaude.meta.agentFilter, 'claude');
    assert.ok(Array.isArray(dataClaude.timeline));
    assert.ok(dataClaude.timeline.length > 0, 'Claude timeline should span recent calendar days');

    const resGrok = await fetch(`${BASE_URL}/api/dashboard?agent=grok`);
    assert.equal(resGrok.status, 200);
    const dataGrok = await resGrok.json();
    assert.equal(dataGrok.meta.agentFilter, 'grok');
    assert.ok(Array.isArray(dataGrok.timeline));
    assert.ok(dataGrok.timeline.length > 0, 'Grok timeline should span recent calendar days');
  });
});
