'use strict';

const CHECKED_AT = '2026-11-19';
const SOURCES = {
  OpenAI: 'https://developers.openai.com/api/docs/pricing',
  Anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  xAI: 'https://docs.x.ai/developers/pricing',
  'Google (Gemini)': 'https://aistudio.google.com/docs/pricing',
  DeepSeek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  '智谱 AI (Z.ai)': 'https://docs.z.ai/guides/overview/pricing',
  'Qwen (通义千问)': 'https://help.aliyun.com/zh/model-studio/model-pricing'
};
const gptLong = new Set(['gpt-5.4','gpt-5.5','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna',
  'gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-6.1-sol','gpt-6.1-terra']);
const grokLong = new Set(['grok-4.7','grok-4.6','grok-4.5','grok-4.3','grok-build-0.1',
  'grok-4.20-multi-agent-0309','grok-4.20-0309-reasoning','grok-4.20-0309-non-reasoning']);
const openaiShort = new Set(['gpt-5.3-codex','gpt-5.4-mini','o3-mini','o1','o1-mini','gpt-4o','gpt-4o-mini']);
const geminiFlash = new Set(['gemini-3.8-flash','gemini-3.6-flash','gemini-3.1-flash-lite','gemini-2.5-flash-lite','Gemini 3.7 Flash']);
const historicalClaude = {
  'claude-3-7-sonnet':['claude-3-7-sonnet','2026-02-19'],
  'claude-3-5-sonnet':['claude-3-5-sonnet','2025-10-28'],
  'claude-3-5-haiku':['3-5-models-and-computer-use','2026-02-19'],
  'claude-3-opus':['claude-3-family','2026-01-05'],
  'claude-3-haiku':['claude-3-family','2026-04-20']
};
const unavailableReferences = {
  'claude-4-haiku':'未核对到这个正式型号；不把 Haiku 4.5 或 3.5 的价格借给它。',
  'grok-4':'旧目录通用名无法唯一确定请求时的型号/价格；grok-4-0709 已改路由，不以新路由冒充历史价。',
  'grok-3':'官方已于 2026-05-15 改路由到 Grok 4.3；旧型号价格不在当前价目中，不把重定向费率当作历史价。',
  'grok-3-mini':'当前公开价目不含此型号，型号页重定向到总目录；API 文档中的示例 JSON 不作为在售价格。',
  'grok-2':'当前公开价目不含此型号，原有常量缺可核对来源。',
  'grok-2-vision':'当前公开价目不含此型号，不借用 Grok 2 文本价或后继视觉价。',
  'grok-beta':'当前公开价目不含此预览名，无法确定所指版本及费率。',
  'deepseek-chat':'官方公告已于 2026-07-24 15:59 UTC 下线此别名；旧值不等于当前 Flash 价格。',
  'deepseek-reasoner':'官方公告已于 2026-07-24 15:59 UTC 下线此别名；不能仅凭别名认定为最初 R1 或某个后继版本。',
  'GLM-4-Plus':'Z.AI 当前 USD 价目不含此型号；不能借用其他站点、地域或托管商的价格。',
  'gemini-2.0-flash':'官方列为 2026-06-01 停服，当前价目已移除；旧快照或日志金额仍保留。',
  'qwen3-max':'当前百炼价目已移除此旧主线；原型号页重定向到总目录，未核对到所选地域价格。',
  'qwen-turbo':'当前百炼价目未列出此旧主线，未核对到所选地域及思考模式价格。',
  'qwen3-coder-plus':'当前百炼价目仅保留 Coder Flash 等后继条目，不以旧搜索摘要补造费率。',
  'qwen3-235b-a22b':'当前价目未列出这个未带版本的开源型号；不同版本/托管商价格不能混用。',
  'qwen-vl-max':'当前价目未列出此旧视觉型号，不借用 VL-OCR 或其他多模态型号价格。',
  'qwq-32b':'当前价目未列出此旧推理型号，原有 USD 值缺所选地域依据。',
  'qwen-2.5-coder-32b':'官方说明 Qwen2.5 系列已下线且无法查询价格；保留旧记录，不把旧常量视为核实价。',
  'qwen-2.5-72b':'官方说明 Qwen2.5 系列已下线且无法查询价格；保留旧记录，不把旧常量视为核实价。'
};
const verified = new Set([...gptLong, ...grokLong, ...openaiShort, ...geminiFlash, 'deepseek-flash','deepseek-v4-pro',
  'claude-fable-5-1','claude-fable-5','claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5',
  'claude-sonnet-5','claude-opus-5','claude-opus-4-8','claude-opus-4-7','claude-opus-4-6',
  'claude-sonnet-4-6','claude-haiku-4-5','claude-4.5-sonnet','claude-4.5-opus',
  'GLM-5.3','GLM-5.2','GLM-5.1','GLM-5','GLM-4.7','GLM-4.6','GLM-4.5',
  'GLM-5.3-FlashX','GLM-5.3-Flash','GLM-4.7-FlashX',
  'gemini-2.5-pro','gemini-2.5-flash']);

function attachCatalogMetadata(catalog) {
  for (const [model,row] of Object.entries(catalog)) {
    row.pricingPolicy = { version: 1, serviceTiers: { default: 1, standard: 1 } };
    row.pricingEvidence = { source: SOURCES[row.company] || null,
      status: verified.has(model) ? 'verified' : 'legacy-reference',
      checkedAt: verified.has(model) ? CHECKED_AT : null,
      currency: 'USD', unit: 'per-million-tokens', region: 'provider-global-reference',
      excludes: ['storage','tools','taxes','subscription-billing'] };
    if (gptLong.has(model)) {
      row.pricingEvidence.source = `https://developers.openai.com/api/docs/models/${model}`;
      row.pricingPolicy.context = { above: 272000, input: 2, cache: 2, output: 1.5 };
      row.pricingPolicy.serviceTiers = { default:1,standard:1,fast:2,priority:2,batch:0.5,flex:0.5 };
      if (['gpt-6-astra','gpt-6.1-sol'].includes(model)) row.pricingPolicy.serviceTiers.ultrafast = 6;
      if (/^gpt-(?:5\.6|6)/.test(model)) row.pricingPolicy.cacheWriteMultipliers = { short:1.25,long:2.5 };
    }
    if (openaiShort.has(model)) {
      row.pricingEvidence.source = `https://developers.openai.com/api/docs/models/${model}`;
      row.pricingEvidence.availability = ['o3-mini','o1','o1-mini'].includes(model) ? 'shut-down'
        : model === 'gpt-5.4-mini' ? 'available' : 'deprecated';
      row.pricingEvidence.note = '官方型号页保留的标准文本参考价；不表示型号当前仍可调用或请求发生时的官方历史价。';
      if (['gpt-5.3-codex','gpt-5.4-mini'].includes(model)) row.pricingPolicy.maxInputTokens = 272000;
      if (model === 'gpt-5.4-mini') row.pricingPolicy.serviceTiers.batch = 0.5;
    }
    if (row.company === 'Anthropic') {
      row.pricingPolicy.cacheWriteMultipliers = { short:1.25,long:2 };
      row.pricingPolicy.serviceTiers.batch = 0.5;
      if (['claude-opus-5-5','claude-opus-5','claude-opus-4-8'].includes(model)) row.pricingPolicy.serviceTiers.fast = 2;
      row.pricingPolicy.inferenceGeos = {global:1};
      if (verified.has(model) && !['claude-haiku-4-5','claude-4.5-opus','claude-4.5-sonnet'].includes(model)) row.pricingPolicy.inferenceGeos.us = 1.1;
    }
    if (historicalClaude[model]) {
      const [article, retiredAt] = historicalClaude[model];
      row.pricingEvidence = {...row.pricingEvidence,status:'verified-historical',checkedAt:CHECKED_AT,
        source:`https://www.anthropic.com/news/${article}`,cacheSource:SOURCES.Anthropic,
        availability:'retired',retiredAt,
        lifecycleSource:'https://platform.claude.com/docs/en/about-claude/model-deprecations',
        note:'官方发布文章保留的历史标准文本参考价，缓存依公开倍率；不表示仍可调用，也不复原请求当时账单。'};
      row.pricingPolicy.maxInputTokens = 200000;
    }
    if (model === 'claude-haiku-5-5') row.pricingPolicy.inputBands = [
      { above:100000,rates:{in:0.5,cache:0.05,out:2.5} }
    ];
    if (grokLong.has(model)) {
      row.pricingPolicy.context = { above:200000,inclusive:true,input:2,cache:2,output:2 };
      row.pricingPolicy.serviceTiers.priority = 2;
      if (model !== 'grok-build-0.1') row.pricingPolicy.serviceTiers.batch = 0.8;
    }
    if (model === 'gemini-2.5-pro') {
      row.pricingPolicy.inputBands = [{above:200000,rates:{in:2.5,cache:0.25,out:15}}];
      row.pricingPolicy.serviceTiers = { default:1,standard:1,
        batch:{input:0.5,cache:1,output:0.5,cacheWrite:1},
        flex:{input:0.5,cache:1,output:0.5,cacheWrite:1},priority:1.8 };
    }
    if (model === 'gemini-2.5-flash') row.pricingPolicy.serviceTiers = {default:1,standard:1,
      batch:{input:0.5,cache:1,output:0.5,cacheWrite:1},
      flex:{input:0.5,cache:1,output:0.5,cacheWrite:1},priority:1.8};
    if (['gemini-2.5-pro','gemini-2.5-flash'].includes(model)) {
      row.pricingPolicy.validThrough = '2026-11-30';
      row.pricingEvidence.note = '旧路由参考价有效至 2026-11-30；之后需核对后继路由，不自动套用旧价。';
    }
    if (geminiFlash.has(model)) {
      // Unlike 2.5, Gemini 3.x explicitly halves cached input for Batch/Flex.
      const thirdGeneration = model !== 'gemini-2.5-flash-lite';
      row.pricingPolicy.serviceTiers = {default:1,standard:1,
        batch:{input:0.5,cache:thirdGeneration ? 0.5 : 1,output:0.5,cacheWrite:1},
        flex:{input:0.5,cache:thirdGeneration ? 0.5 : 1,output:0.5,cacheWrite:1},priority:1.8};
      row.pricingEvidence.source += '#' + (model === 'Gemini 3.7 Flash' ? 'gemini-3.8-flash' : model);
      row.pricingEvidence.note = '付费文本参考价；音频、存储和工具价格不含在内。';
      if (['gemini-3.8-flash','gemini-3.6-flash','Gemini 3.7 Flash'].includes(model)) {
        row.pricingPolicy.validThrough = '2026-12-31';
        row.pricingEvidence.note += ' 当前优惠截至 2026-12-31；2027 年起官方已公布翻倍价，届时需更新目录。';
      }
      if (model === 'Gemini 3.7 Flash') {
        row.pricingEvidence.availability = 'redirected'; row.pricingEvidence.routedTo = 'gemini-3.8-flash';
        row.pricingEvidence.lifecycleSource = 'https://aistudio.google.com/docs/deprecations#gemini-3-models';
        row.pricingEvidence.note += ' 3.7 端点现路由至 3.8；这是当前路由参考，不推定历史请求使用了 3.8。';
      }
    }
    if (model === 'gpt-5.6-sol') row.pricingPolicy.validThrough = '2026-11-30';
    if (row.company === 'DeepSeek') row.pricingEvidence.note = '峰时参考价；缺少已核对时段时不推测非峰时折扣。';
    if (row.company === 'Other / OpenSource') {
      row.unpriced = true;
      row.pricingEvidence.status = 'provider-required';
      row.pricingEvidence.note = '未确定托管提供商；模型名不代表统一 API 费率。';
    }
    if (unavailableReferences[model]) {
      row.unpriced = true;
      row.pricingEvidence = {...row.pricingEvidence,status:'reference-unavailable',checkedAt:CHECKED_AT,
        note:unavailableReferences[model]};
      if (model.startsWith('deepseek-')) row.pricingEvidence.lifecycleSource = 'https://api-docs.deepseek.com/news/news260424/';
      if (['grok-3','grok-4'].includes(model)) row.pricingEvidence.lifecycleSource = 'https://docs.x.ai/developers/migration/may-15-retirement';
      if (model === 'gemini-2.0-flash') row.pricingEvidence.lifecycleSource = 'https://aistudio.google.com/docs/deprecations#gemini-2.0-models';
    }
  }
}

module.exports = { attachCatalogMetadata };
