const os = require('os');
const path = require('path');
const fs = require('fs');
const { MODEL_CATALOG, resolveModelInfo } = require('./models-pricing');

// ZCode 与主价目表使用同一份费率，避免新模型只在弹窗更新而统计仍沿用旧价。
const PRICING_TIERS = {
  standard: Object.fromEntries(Object.entries(MODEL_CATALOG).map(([id, row]) => [id, row.standard])),
  flagship: Object.fromEntries(Object.entries(MODEL_CATALOG).map(([id, row]) => [id, row.flagship || row.standard]))
};

function calculateCost(modelId, inTok, outTok, cacheTok, tier = 'standard') {
  const table = PRICING_TIERS[tier] || PRICING_TIERS.standard;
  const info = resolveModelInfo(modelId, 'zcode');
  const p = table[info.canonicalName] || info.pricing;
  const freshIn = Math.max(0, (inTok || 0) - (cacheTok || 0));
  return (freshIn * p.in + (cacheTok || 0) * p.cache + (outTok || 0) * p.out) / 1e6;
}

function getZCodeDaily(tier = 'standard', force = false) {
  return require('./lib/request-record').recordsToDaily(require('./lib/zcode-source').getRecords(tier, force));
}

function getZCodeMonthly(tier = 'standard') {
  const daily = getZCodeDaily(tier);
  const byMonth = {};
  for (const d of daily) {
    const m = d.date.slice(0, 7);
    if (!byMonth[m]) {
      byMonth[m] = {
        month: m,
        period: m,
        agent: 'zcode',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        modelsUsed: [],
        modelBreakdowns: []
      };
    }
    byMonth[m].inputTokens += d.inputTokens;
    byMonth[m].outputTokens += d.outputTokens;
    byMonth[m].cacheReadTokens += d.cacheReadTokens;
    byMonth[m].totalTokens += d.totalTokens;
    byMonth[m].totalCost += d.totalCost;
    for (const model of d.modelsUsed) {
      if (!byMonth[m].modelsUsed.includes(model)) byMonth[m].modelsUsed.push(model);
    }
    for (const b of d.modelBreakdowns) {
      const existing = byMonth[m].modelBreakdowns.find(x => x.modelName === b.modelName);
      if (existing) {
        existing.inputTokens += b.inputTokens;
        existing.outputTokens += b.outputTokens;
        existing.cacheReadTokens += b.cacheReadTokens;
        existing.totalTokens += b.totalTokens;
        existing.cost += b.cost;
      } else {
        byMonth[m].modelBreakdowns.push({ ...b });
      }
    }
  }
  return Object.values(byMonth);
}

module.exports = { getZCodeDaily, getZCodeMonthly, PRICING_TIERS, calculateCost,
  getUsageRecords: (tier, force) => require('./lib/zcode-source').getRecords(tier, force),
  getDiagnostics: () => require('./lib/zcode-source').getDiagnostics() };
