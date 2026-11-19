'use strict';

const PRICE_SOURCE = 'https://help.aliyun.com/zh/model-studio/model-pricing';
const CACHE_SOURCE = 'https://help.aliyun.com/zh/model-studio/context-cache';
const QWEN_PRICING_REGION = (process.env.QWEN_PRICING_REGION || 'cn-beijing').trim();

// Official CNY / 1M token references, checked 2026-11-19. Each row describes
// the entire request's input band, rather than marginal/progressive pricing.
// Cache prices absent from the public reference stay null.
function regionalReferences(region) {
  const cn = region === 'cn-beijing', global = region === 'global', sg = region === 'intl-singapore';
  if (!cn && !global && !sg) return {};
  return {
    ...(!global ? { 'qwen-max':{ bands:[[0,cn ? 2.4 : 11.743,cn ? 9.6 : 46.971]],
      implicitOnly:cn,unpublishedCache:!cn,unpublishedWrite:!cn } } : {}),
    'qwen-plus':{ bands:sg ? [[0,2.936,null,8.807,29.357],[256000,8.807,null,26.421,88.071]]
      : [[0,0.8,null,2,8],[128000,2.4,null,20,24],[256000,4.8,null,48,64]],batch:cn,maxInputTokens:1000000 },
    'qwen3-coder-flash':{ bands:sg ? [[0,2.202,11.009],[32000,3.67,18.348],[128000,5.871,29.357],[256000,11.743,70.457]]
      : [[0,1,4],[32000,1.5,6],[128000,2.5,10],[256000,5,25]],maxInputTokens:1000000 },
    'qwen3.8-max':{ bands:[[0,sg ? 14.988 : 12,sg ? 44.965 : 36]],unpublishedCache:true,batch:cn,maxInputTokens:1000000 },
    'qwen3.8-flash':{ bands:[[0,sg ? 1.094 : 0.8,sg ? 3.427 : 2.7]],unpublishedCache:true,unpublishedWrite:true,maxInputTokens:1000000 },
    ...(!global ? { 'qwen3.8-27b':{bands:[[0,cn ? 3 : 3.646,cn ? 12 : 21.875]],maxInputTokens:1000000} } : {}),
    'qwen3.7-max':{bands:[[0,sg ? 18.736 : 12,sg ? 56.207 : 36]],batch:cn,maxInputTokens:1000000},
    'qwen3.7-plus':{bands:sg ? [[0,2.998*0.8,11.991*0.8],[256000,8.993*0.8,35.972*0.8]]
      : [[0,1.6,6.4],[256000,4.8,19.2]],batch:cn,maxInputTokens:1000000,promotion:true},
    'qwen3.7-flash':{bands:sg ? [[0,0.225,0.974],[32000,0.749,2.998],[256000,1.499,5.995]]
      : [[0,0.2,0.8],[32000,0.6,2.4],[256000,1.2,4.8]],batch:cn,maxInputTokens:1000000}
  };
}

function applyQwenPricing(catalog, exchangeRate) {
  const references = regionalReferences(QWEN_PRICING_REGION);
  const snapshots = {
    'qwen3.8-max-0902':'qwen3.8-max',
    'qwen3.7-max-2026-05-20':'qwen3.7-max',
    'qwen3.7-max-2026-06-08':'qwen3.7-max',
    'qwen3.7-plus-2026-05-26':'qwen3.7-plus',
    'qwen3.7-flash-2026-07-15':'qwen3.7-flash'
  };
  for (const [snapshot,base] of Object.entries(snapshots)) {
    catalog[snapshot] = {...catalog[base],label:`${catalog[base].label} · ${snapshot.slice(base.length+1)}`};
    if (!references[base]) continue;
    references[snapshot] = {...references[base],batch:false,promotion:false};
    if (base === 'qwen3.7-plus') references[snapshot].bands = QWEN_PRICING_REGION === 'intl-singapore'
      ? [[0,2.998,11.991],[256000,8.993,35.972]] : [[0,2,8],[256000,6,24]];
  }
  const known = new Set(['qwen-max','qwen-plus','qwen3-coder-flash','qwen3.8-max','qwen3.8-flash',
    'qwen3.8-27b','qwen3.7-max','qwen3.7-plus','qwen3.7-flash',...Object.keys(snapshots)]);
  const usd = value => value === null ? null : value / exchangeRate;
  for (const [model,row] of Object.entries(catalog)) {
    if (row.company !== 'Qwen (通义千问)') continue;
    row.pricingEvidence = { ...row.pricingEvidence,region:QWEN_PRICING_REGION,source:PRICE_SOURCE,cacheSource:CACHE_SOURCE };
    const reference = references[model];
    if (!reference) {
      if (known.has(model) || !['cn-beijing','global','intl-singapore'].includes(QWEN_PRICING_REGION)) {
        row.unpriced = true;
        row.pricingEvidence.status = 'region-unavailable';
        row.pricingEvidence.note = '该参考地域未核对到此型号费率；不借用其他地域。';
      } else row.pricingEvidence.note = '旧参考值待核对；不表示所选地域的当前官方价格。';
      continue;
    }
    const bands = reference.bands.map(([above,input,output,nonThinking,thinking]) => ({ above,
      rates:{in:usd(input),out:usd(output),cache:reference.implicitOnly ? usd(input*0.2) : null},
      ...(!reference.unpublishedCache ? {cacheReadByMode:reference.implicitOnly
        ? {implicit:usd(input*0.2)} : {implicit:usd(input*0.2),explicit:usd(input*0.1)}} : {}),
      ...(output === null ? {outputByReasoningMode:{'non-thinking':usd(nonThinking),thinking:usd(thinking)}} : {})
    }));
    const [base,...higher] = bands;
    row.standard = base.rates;
    row.flagship = base.rates;
    row.pricingPolicy = { version:1,serviceTiers:{default:1,standard:1,...(reference.batch ? {batch:0.5} : {})},
      ...(reference.batch ? {cacheUnavailableTiers:['batch']} : {}),
      ...(reference.maxInputTokens ? {maxInputTokens:reference.maxInputTokens} : {}),
      ...(base.cacheReadByMode ? {cacheReadByMode:base.cacheReadByMode} : {}),
      ...(base.outputByReasoningMode ? {outputByReasoningMode:base.outputByReasoningMode} : {}),
      ...(!reference.implicitOnly && !reference.unpublishedWrite ? {cacheWriteMultipliers:{short:1.25,long:null}} : {}),
      ...(higher.length ? {inputBands:higher} : {}) };
    row.pricingEvidence = { ...row.pricingEvidence,status:'verified',checkedAt:'2026-11-19',
      originalCurrency:'CNY',exchangeRateCNYPerUSD:exchangeRate,
      exchangeRateBasis:!process.env.QWEN_USD_CNY_RATE ? 'default-reference-assumption'
        : Number.isFinite(Number(process.env.QWEN_USD_CNY_RATE)) && Number(process.env.QWEN_USD_CNY_RATE) > 0
          ? 'configured-assumption' : 'invalid-config-default-assumption',
      originalRates:reference.bands.map(([above,input,output,nonThinking,thinking]) => ({above,input,output,
        ...(output === null ? {nonThinkingOutput:nonThinking,thinkingOutput:thinking} : {})})),
      note:'所选地域的文本参考价；缓存模式或思考模式缺失时，仅汇总已知金额。'
        + (reference.unpublishedCache ? ' 缓存命中价未能从公开依据核实，当前保留未知。' : '')
        + (reference.promotion ? ' 当前别名含限时八折；官方未给结束日，快照保留此次核对依据。' : '') };
  }
}

function qwenUsageContext(row, usage = {}, written = 0) {
  const enableThinking = row.enable_thinking ?? row.parameters?.enable_thinking;
  const reasoningMode = ['thinking','non-thinking'].includes(row.reasoningMode) ? row.reasoningMode
    : typeof enableThinking === 'boolean' ? enableThinking ? 'thinking' : 'non-thinking'
      : Number(usage.thoughtsTokenCount) > 0 ? 'thinking' : null;
  const cacheMode = row.cacheMode || row.cache_mode;
  return { ...(reasoningMode ? {reasoningMode} : {}),
    ...(['implicit','explicit'].includes(cacheMode) ? {cacheMode} : written ? {cacheMode:'explicit'} : {}),
    ...(written ? {cacheWrite:{shortTokens:written,longTokens:0}} : {}) };
}

module.exports = { applyQwenPricing,QWEN_PRICING_REGION,qwenUsageContext };
