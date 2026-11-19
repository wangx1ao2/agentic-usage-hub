const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 临时夹具目录（QoderWork CN 会话 jsonl）─────────────────────────
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-qoder-'));
process.env.QODER_SESSIONS_DIR = path.join(fixtureRoot, 'qoder-projects');

const projDir = path.join(process.env.QODER_SESSIONS_DIR, 'P--fixture-demo');
fs.mkdirSync(projDir, { recursive: true });

const A_TEXT = 'A'.repeat(280);   // user1: 280 chars → 100 in-tokens（÷2.8）
const B_TEXT = 'B'.repeat(320);   // assistant1: 320 chars → 100 out-tokens（÷3.2）
const C_TEXT = 'C'.repeat(140);   // user2: 140 chars
const D_TEXT = 'D'.repeat(160);   // assistant2 thinking: 160 chars → 50 out-tokens

const assistantDup = JSON.stringify({
  type: 'assistant',
  message: { id: 'msg_a1', model: 'qfmodel', role: 'assistant', content: [{ type: 'text', text: B_TEXT }] },
  timestamp: '2020-01-05T10:00:05'
});

fs.writeFileSync(path.join(projDir, 's1.jsonl'), [
  JSON.stringify({ type: 'summary', sessionId: 's1', directories: ['P:\\fixture\\demo'] }),
  JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: A_TEXT }, timestamp: '2020-01-05T10:00:00' }),
  assistantDup, assistantDup, assistantDup, // 同 message.id 重复记录 → 只入账一次
  JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: C_TEXT }, timestamp: '2020-01-05T10:00:10' }),
  JSON.stringify({
    type: 'assistant',
    message: { id: 'msg_a2', model: 'qmodel', role: 'assistant', content: [{ type: 'thinking', thinking: D_TEXT }] },
    timestamp: '2020-01-05T10:00:15'
  })
].join('\n') + '\n', 'utf8');

// ── 被测模块（env 必须先于 require 生效 — 适配器为调用时读取，双保险）──
const qoderwork = require('../qoderwork-adapter');
const { resolveModelInfo, calculateModelCost } = require('../models-pricing');
const projectAdapter = require('../project-adapter');

test('QoderWork CN Adapter & Estimated-Token Monitoring', async (t) => {

  await t.test('1. parses sessions with dedup by message.id and correct estimation math', () => {
    const daily = qoderwork.getQoderDaily(true);
    assert.equal(daily.length, 1);
    const d = daily[0];
    assert.equal(d.date, '2020-01-05');
    assert.equal(d.agent, 'qoderwork');
    assert.equal(d.estimated, true);
    // 4 条 assistant 记录去重后 = 2 次调用
    assert.equal(d.calls, 2);
    // call1: ctx=280 → in=100, out=320/3.2=100, cache=(280-280)/2.8=0
    // call2: ctx=280+320+140=740 → in=round(740/2.8)=264, out=160/3.2=50, cache=round((740-140)/2.8)=214
    assert.equal(d.inputTokens, 100 + 264);
    assert.equal(d.outputTokens, 100 + 50);
    assert.equal(d.cacheReadTokens, 0 + 214);
    assert.equal(d.totalTokens, (100 + 264) + (100 + 50));
  });

  await t.test('2. maps qoder model keys to Qwen3.8 catalog with USD-converted pricing', () => {
    const daily = qoderwork.getQoderDaily(false);
    const d = daily[0];
    const flash = d.modelBreakdowns.find(m => m.modelName === 'Qwen3.8 Flash (QoderWork)');
    const max = d.modelBreakdowns.find(m => m.modelName === 'Qwen3.8 Max (QoderWork)');
    assert.ok(flash && max, 'qfmodel→flash / qmodel→max 均应出现');
    assert.equal(flash.agent, 'qoderwork');
    assert.equal(flash.company, 'Qwen (通义千问)');
    // flash: 100 in*0.112 + 100 out*0.378 = 49e-6 ≈ 0.000049
    assert.ok(Math.abs(flash.cost - 0.000049) < 0.00001, `flash cost ${flash.cost}`);
    // Max cache hit price is not public: preserve only the known input/output subtotal.
    assert.equal(max.cost,0.000336);
    assert.equal(max.costComplete,false);
    assert.equal(max.unpricedTokens,max.cacheReadTokens);
    assert.ok(d.totalCost > 0);
  });

  await t.test('3. resolveModelInfo: qoder keys → agent=qoderwork; real qwen3.8 names stay agent=qwen', () => {
    assert.equal(resolveModelInfo('qfmodel', 'qoderwork').canonicalName, 'qwen3.8-flash');
    assert.equal(resolveModelInfo('qfmodel', 'qoderwork').agent, 'qoderwork');
    assert.equal(resolveModelInfo('qmodel', 'qoderwork').canonicalName, 'qwen3.8-max');
    assert.equal(resolveModelInfo('qmodel_38max', 'qoderwork').canonicalName, 'qwen3.8-max');
    assert.equal(resolveModelInfo('auto', 'qoderwork').canonicalName, 'qwen3.8-max');
    assert.equal(resolveModelInfo('qwen3.8-max', 'qoderwork').agent, 'qwen');
    // 目录价 = 百炼 CNY / 7.15
    const p = resolveModelInfo('qwen3.8-max', 'qwen').pricing;
    assert.equal(p.in, 12 / 7.15);
    assert.equal(p.out, 36 / 7.15);
    const f = resolveModelInfo('qwen3.8-flash', 'qwen').pricing;
    assert.equal(f.in, 0.8 / 7.15);
    assert.equal(f.cache, null, 'A console-only cache rate is unknown, never free');
  });

  await t.test('4. incremental append re-parse keeps dedup state consistent', () => {
    qoderwork.getQoderDaily(true);
    fs.appendFileSync(path.join(projDir, 's1.jsonl'), [
      JSON.stringify({ type: 'user', uuid: 'u3', message: { role: 'user', content: 'E'.repeat(280) }, timestamp: '2020-01-05T10:01:00' }),
      JSON.stringify({
        type: 'assistant',
        message: { id: 'msg_a3', model: 'qfmodel', content: [{ type: 'text', text: 'F'.repeat(320) }] },
        timestamp: '2020-01-05T10:01:05'
      })
    ].join('\n') + '\n', 'utf8');
    fs.appendFileSync(path.join(projDir, 's1.jsonl'), JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_a3', model: 'qfmodel', content: [{ type: 'text', text: 'F'.repeat(320) }] },
      timestamp: '2020-01-05T10:01:05'
    }) + '\n', 'utf8'); // 重复记录不应二次入账

    const d = qoderwork.getQoderDaily(true)[0];
    assert.equal(d.calls, 3);
    // call3: ctx=740+160+280=1180 → in=round(1180/2.8)=421; out=100; cache=round((1180-280)/2.8)=321
    assert.equal(d.inputTokens, 100 + 264 + 421);
    assert.equal(d.cacheReadTokens, 0 + 214 + 321);

    // 还原夹具，让后续用例数字保持基线
    fs.writeFileSync(path.join(projDir, 's1.jsonl'), [
      JSON.stringify({ type: 'summary', sessionId: 's1', directories: ['P:\\fixture\\demo'] }),
      JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: A_TEXT }, timestamp: '2020-01-05T10:00:00' }),
      assistantDup,
      JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: C_TEXT }, timestamp: '2020-01-05T10:00:10' }),
      JSON.stringify({
        type: 'assistant',
        message: { id: 'msg_a2', model: 'qmodel', role: 'assistant', content: [{ type: 'thinking', thinking: D_TEXT }] },
        timestamp: '2020-01-05T10:00:15'
      })
    ].join('\n') + '\n', 'utf8');
    const back = qoderwork.getQoderDaily(true)[0];
    assert.equal(back.calls, 2, '回滚后应恢复 2 次调用（幂等重建）');
  });

  await t.test('5. project attribution exposes qoderwork with estimated flag', () => {
    qoderwork.getQoderDaily(true); // 预热并刷新内部缓存，确保归因用例基于基线夹具
    const projects = projectAdapter.getProjectAttributionList();
    const qp = projects.find(p => p.agents.includes('qoderwork'));
    assert.ok(qp, 'qoderwork 归因项目必须存在');
    assert.equal(qp.estimated, true);
    assert.equal(qp.totalTokens, 514);
    assert.ok(qp.companies.qwen.tokens >= 514);
    assert.ok(qp.companies.qwen.cost >= 0); // 夹具用量小，$0.00 级别（输出两位小数）
    assert.ok(qp.topModels.some(m => String(m.model).includes('Qwen3.8')));
    assert.ok(qp.paths.includes('P:\\fixture\\demo'));
  });

  await t.test('6. buildDashboardData(agent=qoderwork) isolates estimated timeline', () => {
    const { buildDashboardData } = require('../unified-server');
    const data = buildDashboardData('standard', 'qoderwork');
    assert.equal(data.meta.agentFilter, 'qoderwork');

    const day = data.timeline.find(d => d.date === '2020-01-05');
    assert.ok(day, 'fixture day must appear under qoderwork filter');
    assert.equal(day.totalTokens, 514);
    assert.equal(day.byCompany['Qwen (通义千问)'].tokens, 514);
    assert.equal(day.byCompany['OpenAI'].tokens, 0, '其它厂商在 qoderwork 过滤下必须为 0');
    assert.ok(day.byModel['Qwen3.8 Flash (QoderWork)']);
    assert.ok(day.byModel['Qwen3.8 Max (QoderWork)']);

    assert.equal(data.agentBreakdown.qoderwork.totalTokens, 514);
    assert.equal(data.agentBreakdown.qoderwork.estimated, true);

    const qfam = data.modelFamilies.find(f => (f.company || '').includes('Qwen'));
    assert.ok(qfam, 'Qwen 家族必须包含 QoderWork 模型');
    assert.ok(qfam.subModels.some(m => m.modelName.includes('(QoderWork)')));
  });
});
