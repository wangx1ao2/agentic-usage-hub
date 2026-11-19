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
const verified = new Set([...gptLong, ...grokLong, 'deepseek-flash','deepseek-v4-pro',
  'claude-fable-5-1','claude-fable-5','claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5',
  'claude-sonnet-5','claude-opus-5','claude-opus-4-8','claude-opus-4-7','claude-opus-4-6',
  'claude-sonnet-4-6','claude-haiku-4-5','claude-4.5-sonnet','claude-4.5-opus',
  'GLM-5.3','GLM-5.2','GLM-5.1','GLM-5','GLM-4.7','GLM-4.6','GLM-4.5',
  'GLM-5.3-FlashX','GLM-5.3-Flash','GLM-4.7-FlashX',
  'gemini-2.5-pro','gemini-2.5-flash']);

function attachCatalogMetadata(catalog, exchangeRate) {
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
    if (row.company === 'Anthropic') {
      row.pricingPolicy.cacheWriteMultipliers = { short:1.25,long:2 };
      row.pricingPolicy.serviceTiers.batch = 0.5;
    }
    if (model === 'claude-haiku-5-5') row.pricingPolicy.inputBands = [
      { above:100000,rates:{in:0.5,cache:0.05,out:2.5} }
    ];
    if (grokLong.has(model)) row.pricingPolicy.context = { above:200000,inclusive:true,input:2,cache:2,output:2 };
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
    if (model === 'gpt-5.6-sol') row.pricingPolicy.validThrough = '2026-11-30';
    if (row.company === 'Qwen (通义千问)') row.pricingEvidence.exchangeRateCNYPerUSD = exchangeRate;
    if (row.company === 'DeepSeek') row.pricingEvidence.note = '峰时参考价；缺少已核对时段时不推测非峰时折扣。';
    if (row.company === 'Other / OpenSource') {
      row.unpriced = true;
      row.pricingEvidence.status = 'provider-required';
      row.pricingEvidence.note = '未确定托管提供商；模型名不代表统一 API 费率。';
    }
  }
}

module.exports = { attachCatalogMetadata };
