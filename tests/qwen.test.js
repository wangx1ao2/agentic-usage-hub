const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 临时夹具目录（Qwen 会话 + 计量日志 + 生图安全用例）─────────────
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-qwen-'));
process.env.QWEN_SESSIONS_DIR = path.join(fixtureRoot, 'qwen-projects');
process.env.QWEN_USAGE_FILE = path.join(fixtureRoot, 'qwen-usage.jsonl');

// 1) Qwen Code 会话日志: <root>/<project>/chats/*.jsonl (usageMetadata 口径)
const chatsDir = path.join(process.env.QWEN_SESSIONS_DIR, '-tmp-demo-proj', 'chats');
fs.mkdirSync(chatsDir, { recursive: true });
fs.writeFileSync(path.join(chatsDir, 's1.jsonl'), [
  JSON.stringify({
    timestamp: '2020-01-03T08:00:00',
    model: 'qwen3-max',
    usageMetadata: {
      promptTokenCount: 1_000_000,
      candidatesTokenCount: 200_000,
      thoughtsTokenCount: 0,
      cachedContentTokenCount: 400_000,
      totalTokenCount: 1_200_000
    }
  }),
  JSON.stringify({ timestamp: '2020-01-03T08:00:05', model: 'qwen3-max', text: 'no usage here' })
].join('\n') + '\n', 'utf8');

// 2) DashScope 平铺计量日志
fs.writeFileSync(process.env.QWEN_USAGE_FILE, JSON.stringify({
  ts: '2020-01-04T09:00:00',
  model: 'qwen-turbo',
  promptTokens: 1_000_000,
  completionTokens: 500_000,
  cacheHitTokens: 0
}) + '\n', 'utf8');

// 3) /api/codex-image 安全夹具: 1x1 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
// 合法: 真实 generated_images 目录层级
const legitDir = path.join(fixtureRoot, 'generated_images');
fs.mkdirSync(legitDir, { recursive: true });
const legitPng = path.join(legitDir, 'ok.png');
fs.writeFileSync(legitPng, PNG_1PX);
// 攻击面: 目录名仅"包含" generated_images 子串 (旧实现 includes() 会被绕过)
const sneakyDir = path.join(fixtureRoot, 'evil_generated_images_cache');
fs.mkdirSync(sneakyDir, { recursive: true });
const sneakyPng = path.join(sneakyDir, 'spy.png');
fs.writeFileSync(sneakyPng, PNG_1PX);

// C2/C3 后 /api/codex-image 只允许白名单根目录 (env CODEX_IMAGE_DIRS + ~/.codex/generated_images),
// 因此测试夹具必须通过 env 显式登记 legitDir;sneakyDir 故意不登记以验证子串绕过被拒。
process.env.CODEX_IMAGE_DIRS = legitDir;

// ── 被测模块 (env 必须先于 require 生效 — 适配器为调用时读取，双保险) ──
const qwen = require('../qwen-adapter');
const { resolveModelInfo, calculateModelCost } = require('../models-pricing');
const projectAdapter = require('../project-adapter');
const { server } = require('../unified-server');

test('Qwen Adapter & Monitoring', async (t) => {

  await t.test('1. getQwenDaily parses usageMetadata session logs with correct cost', () => {
    const daily = qwen.getQwenDaily(true);
    const d = daily.find(x => x.date === '2020-01-03');
    assert.ok(d, 'session fixture day must appear in daily timeline');
    assert.equal(d.agent, 'qwen');
    assert.equal(d.totalTokens, 1_200_000);
    assert.equal(d.inputTokens, 1_000_000);
    assert.equal(d.outputTokens, 200_000);
    assert.equal(d.cacheReadTokens, 400_000);
    // qwen3-max: fresh 600k*$1.20 + cache 400k*$0.30 + out 200k*$6.00 = 0.72+0.12+1.20 = $2.04
    assert.equal(+d.totalCost.toFixed(2), 2.04);
    assert.ok(d.modelsUsed.includes('qwen3-max (Qwen)'));
  });

  await t.test('2. getQwenDaily parses DashScope flat usage.jsonl format', () => {
    const daily = qwen.getQwenDaily(false);
    const d = daily.find(x => x.date === '2020-01-04');
    assert.ok(d, 'flat usage fixture day must appear');
    assert.equal(d.totalTokens, 1_500_000);
    // qwen-turbo: 1M*$0.05 + 0.5M*$0.20 = $0.15
    assert.equal(+d.totalCost.toFixed(2), 0.15);
    assert.ok(d.modelsUsed.includes('qwen-turbo (Qwen)'));
    const mb = d.modelBreakdowns.find(m => m.modelName === 'qwen-turbo (Qwen)');
    assert.equal(mb.company, 'Qwen (通义千问)');
    assert.equal(mb.agent, 'qwen');
  });

  await t.test('3. Qwen fuzzy model resolution', () => {
    assert.equal(resolveModelInfo('qwen3-max').canonicalName, 'qwen3-max');
    assert.equal(resolveModelInfo('qwen3-max').company, 'Qwen (通义千问)');
    assert.equal(resolveModelInfo('qwen3-max').agent, 'qwen');
    assert.equal(resolveModelInfo('dashscope/qwen-plus-latest').canonicalName, 'qwen-plus');
    assert.equal(resolveModelInfo('qwq-32b-preview').canonicalName, 'qwq-32b');
    assert.equal(resolveModelInfo('qwen3-coder-flash-2507').canonicalName, 'qwen3-coder-flash');
    assert.equal(resolveModelInfo('qwen3-coder-plus').canonicalName, 'qwen3-coder-plus');
    assert.equal(resolveModelInfo('qwen2.5-coder-32b-instruct').canonicalName, 'qwen-2.5-coder-32b');
    assert.equal(resolveModelInfo('qwen-vl-max-0809').canonicalName, 'qwen-vl-max');
    assert.equal(resolveModelInfo('qwen-turbo').canonicalName, 'qwen-turbo');
  });

  await t.test('4. Qwen pricing math sanity (qwen-plus with cache hit)', () => {
    // 1M in (200k cache), 500k out → 0.8*$0.40 + 0.2*$0.16 + 0.5*$1.20 = 0.32+0.032+0.60
    const cost = calculateModelCost('qwen-plus', 1_000_000, 500_000, 200_000);
    assert.equal(+cost.toFixed(4), 0.9520);
  });

  await t.test('5. Project attribution includes Qwen sessions per workspace', () => {
    const projects = projectAdapter.getProjectAttributionList();
    const qwenProject = projects.find(p => p.agents.includes('qwen'));
    assert.ok(qwenProject, 'a qwen-attributed project must exist');
    assert.ok(qwenProject.companies.qwen.tokens >= 1_200_000, 'qwen tokens must be attributed');
    assert.ok(qwenProject.companies.qwen.cost > 0, 'qwen cost must be attributed');
  });

  // in-process 聚合断言 (确定性: 直接读取本测试进程的夹具环境变量, 不依赖已运行服务)
  const { buildDashboardData } = require('../unified-server');

  await t.test('6. buildDashboardData(agent=qwen) merges qwen vendors correctly', () => {
    const data = buildDashboardData('standard', 'qwen');
    assert.equal(data.meta.agentFilter, 'qwen');

    const qwenCompany = data.companies.find(c => c.name === 'Qwen (通义千问)');
    assert.ok(qwenCompany, 'companies list must include Qwen');

    const day = data.timeline.find(d => d.date === '2020-01-03');
    assert.ok(day, 'fixture day must exist in filtered timeline');
    assert.equal(day.byCompany['Qwen (通义千问)'].tokens, 1_200_000);
    assert.ok(day.byModel['qwen3-max (Qwen)'], 'byModel must include canonical qwen model');
    // Non-qwen vendors must be zeroed out under the qwen filter
    assert.equal(day.byCompany['OpenAI'].tokens, 0);

    const flatDay = data.timeline.find(d => d.date === '2020-01-04');
    assert.ok(flatDay && flatDay.byCompany['Qwen (通义千问)'].tokens === 1_500_000);
  });

  await t.test('7. agentBreakdown exposes qwen block', () => {
    const data = buildDashboardData('standard', 'all');
    assert.ok(data.agentBreakdown.qwen, 'agentBreakdown.qwen must exist');
    assert.ok(data.agentBreakdown.qwen.totalTokens >= 2_700_000, 'qwen tokens must include fixtures');
  });

  // HTTP 层用例: 使用临时随机端口，避免与本机已运行的看板实例冲突
  const httpServer = await new Promise(resolve => {
    const s = server.listen(0, '127.0.0.1', () => resolve(s));
  });
  const BASE = `http://127.0.0.1:${httpServer.address().port}`;
  t.after(() => httpServer.close());

  await t.test('8. GET /api/dashboard whitelist accepts agent=qwen (HTTP)', async () => {
    const res = await fetch(`${BASE}/api/dashboard?agent=qwen`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.meta.agentFilter, 'qwen', 'qwen must be a whitelisted agent filter');
  });

  await t.test('9. /api/codex-image rejects generated_images SUBSTRING bypass dirs', async () => {
    const sneaky = await fetch(`${BASE}/api/codex-image?path=${encodeURIComponent(sneakyPng)}`);
    assert.equal(sneaky.status, 404, 'directory merely CONTAINING generated_images substring must be denied');
  });

  await t.test('10. /api/codex-image allows genuine generated_images directory', async () => {
    const ok = await fetch(`${BASE}/api/codex-image?path=${encodeURIComponent(legitPng)}`);
    assert.equal(ok.status, 200, 'exact generated_images directory segment must be served');
    assert.match(ok.headers.get('content-type'), /image\/png/);
  });
});
