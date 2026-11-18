'use strict';
const { MODEL_CATALOG, resolveModelInfo, calculateModelCost, autoReviewCostBasis } = require('../models-pricing');

function getCcusageBreakdownCost(modelName, breakdown) {
  // Discard any native fallback amount: this ID uses the user-selected Sol
  // estimate, with request-specific pricing when the snapshots agree.
  if (modelName === 'codex-auto-review') {
    if (resolveModelInfo(modelName, 'codex').unpriced) return { cost: 0, estimated: true, unpriced: true };
    const cost = Number.isFinite(breakdown.requestPricing?.cost) ? breakdown.requestPricing.cost
      : calculateModelCost(modelName, (Number(breakdown.inputTokens) || 0) + (Number(breakdown.cacheReadTokens) || 0),
        Number(breakdown.outputTokens) || 0, Number(breakdown.cacheReadTokens) || 0);
    return { cost, estimated: true, unpriced: false };
  }
  const reported = Number(breakdown.cost ?? breakdown.costUSD ?? 0) || 0;
  if (reported > 0) return { cost: reported, estimated: false, unpriced: false };
  const info = resolveModelInfo(modelName, 'codex');
  if (!(/^gpt-6(?:\.1)?-(?:astra|sol|luna)$/.test(info.canonicalName) || info.canonicalName === 'gpt-6.1-terra') || !MODEL_CATALOG[info.canonicalName]) {
    return { cost: reported, estimated: false, unpriced: !!info.unpriced };
  }
  if (Number.isFinite(breakdown.requestPricing?.cost)) {
    const cost = breakdown.requestPricing.cost;
    return { cost, estimated: cost > 0, unpriced: false };
  }
  const freshInput = Number(breakdown.inputTokens) || 0;
  const cachedInput = Number(breakdown.cacheReadTokens) || 0;
  const output = Number(breakdown.outputTokens) || 0;
  // ccusage reports fresh input separately from cached input. The shared
  // calculator expects input to include cached tokens, so add them here.
  const cost = calculateModelCost(info.canonicalName, freshInput + cachedInput, output, cachedInput);
  return { cost, estimated: cost > 0, unpriced: false };
}

function normalizeCcusageDaily(codexRaw) {
  return (codexRaw.daily || []).map(d => {
    const dayDate = d.date || d.period || '';
    const reportedDayTotalCost = +(d.totalCost || d.costUSD || d.cost || 0);
    const dayTotalTokens = d.totalTokens || ((d.inputTokens || 0) + (d.outputTokens || 0) + (d.cacheReadTokens || 0) + (d.cacheCreationTokens || 0));

    let breakdowns = [];

    // Format A: modelBreakdowns array (from ccusage daily --json)
    if (Array.isArray(d.modelBreakdowns) && d.modelBreakdowns.length > 0) {
      breakdowns = d.modelBreakdowns.map(b => {
        const mName = b.modelName || 'unknown (unallocated)';
        const info = resolveModelInfo(mName, 'codex');
        const amount = getCcusageBreakdownCost(mName, b);
        return {
          modelName: mName,
          agent: b.agent || info.agent || 'codex',
          company: info.company,
          inputTokens: b.inputTokens || 0,
          outputTokens: b.outputTokens || 0,
          cacheReadTokens: b.cacheReadTokens || 0,
          cacheCreationTokens: b.cacheCreationTokens || 0,
          totalTokens: b.totalTokens || ((b.inputTokens || 0) + (b.outputTokens || 0) + (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0)),
          cost: amount.cost,
          costBasis: mName === 'codex-auto-review' ? autoReviewCostBasis : 'catalog-estimate', costEstimated: true,
          unpriced: amount.unpriced
        };
      });
    }
    // Format B: models map (from ccusage codex daily --json)
    else if (d.models && typeof d.models === 'object' && Object.keys(d.models).length > 0) {
      const modelKeys = Object.keys(d.models);
      const totalAllTokens = modelKeys.reduce((s, k) => s + (d.models[k].totalTokens || 0), 0) || 1;

      for (const [mName, mInfo] of Object.entries(d.models)) {
        const mTokens = mInfo.totalTokens || ((mInfo.inputTokens || 0) + (mInfo.outputTokens || 0) + (mInfo.cacheReadTokens || 0) + (mInfo.cacheCreationTokens || 0));
        let mCost = mInfo.costUSD !== undefined ? mInfo.costUSD : mInfo.cost;
        if (mCost === undefined || mCost === null) {
          mCost = modelKeys.length === 1 ? reportedDayTotalCost : (reportedDayTotalCost * (mTokens / totalAllTokens));
        }

        const info = resolveModelInfo(mName, 'codex');
        const amount = getCcusageBreakdownCost(mName, { ...mInfo, cost: mCost });
        breakdowns.push({
          modelName: mName,
          agent: info.agent || 'codex',
          company: info.company,
          inputTokens: mInfo.inputTokens || 0,
          outputTokens: mInfo.outputTokens || 0,
          cacheReadTokens: mInfo.cacheReadTokens || 0,
          cacheCreationTokens: mInfo.cacheCreationTokens || 0,
          totalTokens: mTokens,
          cost: amount.cost,
          costBasis: mName === 'codex-auto-review' ? autoReviewCostBasis : 'catalog-estimate', costEstimated: true,
          unpriced: amount.unpriced
        });
      }
    }
    // A model list alone does not identify each model's contribution. Preserve
    // the measured totals in an explicit unallocated bucket rather than inventing
    // equal token/cost shares or a default model name.
    else if (dayTotalTokens > 0) {
      breakdowns.push({
        modelName: 'unknown (unallocated)', agent: d.agent || 'codex', company: 'OpenAI',
        inputTokens: d.inputTokens || 0, outputTokens: d.outputTokens || 0,
        cacheReadTokens: d.cacheReadTokens || 0, cacheCreationTokens: d.cacheCreationTokens || 0, totalTokens: dayTotalTokens,
        cost: reportedDayTotalCost, costBasis: 'catalog-unallocated-estimate', costEstimated: true, unpriced: reportedDayTotalCost <= 0
      });
    }

    const dayTotalCost = breakdowns.length > 0
      ? breakdowns.reduce((sum, b) => sum + b.cost, 0)
      : reportedDayTotalCost;
    return {
      date: dayDate,
      agent: 'codex',
      inputTokens: d.inputTokens || 0,
      outputTokens: d.outputTokens || 0,
      cacheReadTokens: d.cacheReadTokens || 0,
      cacheCreationTokens: d.cacheCreationTokens || 0,
      totalTokens: dayTotalTokens,
      totalCost: dayTotalCost,
      modelsUsed: breakdowns.map(b => b.modelName),
      modelBreakdowns: breakdowns
    };
  });
}
module.exports = { normalizeCcusageDaily, getCcusageBreakdownCost };
