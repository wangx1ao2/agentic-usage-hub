'use strict';

const { createHash } = require('node:crypto');
const { resolveModelInfo } = require('../models-pricing');
const { isDate } = require('./validation');
const number = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

// Canonical token contract: inputTokens is NEW input, cache reads/writes are
// separate components, and output includes reasoning exactly once. An aggregate
// never invents a request timestamp or project path that the source didn't log.
function normalizeDaily(days, source, options = {}) {
  return days.flatMap(day => {
    const date = day.date || day.period;
    if (!isDate(date)) return [];
    const breakdowns = day.modelBreakdowns?.length ? day.modelBreakdowns : [{ ...day,
      modelName: day.modelName || 'unknown', cost: day.totalCost }];
    return breakdowns.map((row, index) => {
      const agent = String(row.agent || source);
      const model = String(row.modelName || row.rawModel || 'unknown');
      const info = resolveModelInfo(row.rawModel || model, agent);
      const cached = number(row.cacheReadTokens);
      const write = number(row.cacheCreationTokens);
      const input = number(row.inputTokens);
      const fresh = options.freshInput ? input : Math.max(0, input - cached);
      const output = number(row.outputTokens);
      const estimated = !!(options.estimated || row.estimated || day.estimated);
      const unpriced = !!row.unpriced || (!!info.unpriced && !number(row.cost));
      const identity = JSON.stringify([source, agent, date, model, index]);
      return {
        schemaVersion: 1, id: createHash('sha256').update(identity).digest('hex').slice(0, 24),
        source: agent, collection: source, model, canonicalModel: info.canonicalName,
        company: String(row.company || day.company || info.company),
        date, timestamp: null, sessionId: null, projectPath: null, granularity: 'day-model',
        inputTokens: fresh, cacheReadTokens: cached, cacheWriteTokens: write, outputTokens: output,
        totalTokens: number(row.totalTokens) || fresh + cached + write + output,
        costUSD: unpriced ? null : number(row.cost), currency: 'USD',
        tokenBasis: estimated ? 'estimated' : 'logged',
        costBasis: unpriced ? 'unpriced' : row.costBasis || (row.costEstimated || source !== 'ccusage' ? 'catalog-estimate' : 'reported'),
        estimated, costEstimated: estimated || !!row.costEstimated || source !== 'ccusage', unpriced,
        costComplete:!unpriced && row.costComplete !== false && (!write || row.costComplete === true),
        pricingContext:row.pricingContext || null
      };
    });
  });
}

function matchesSource(record, source) {
  return source === 'all' || record.source === source || (source === 'openclaw' && record.source === 'reasonix');
}

module.exports = { normalizeDaily, matchesSource };
