'use strict';

const { createHash } = require('node:crypto');
const { resolveModelInfo, calculateModelCost } = require('../models-pricing');
const { getLocalDateStr } = require('./date');
const { canonicalWorkspacePath } = require('./project-path');
const { isDate } = require('./validation');
const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : 0;

function timestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const timestamp = numeric ? Number(value) * (Number(value) < 1e11 ? 1000 : 1) : Date.parse(value);
  return Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null;
}

function createRequestRecord(input) {
  const timestamp = timestampMs(input.timestamp);
  const date = timestamp === null ? isDate(input.date) ? input.date : null : getLocalDateStr(new Date(timestamp));
  if (date === null) return null;
  const source = String(input.source), rawModel = String(input.rawModel || input.model || 'unknown');
  const info = resolveModelInfo(rawModel, source);
  const fresh = count(input.inputTokens), cached = count(input.cacheReadTokens), write = count(input.cacheWriteTokens), output = count(input.outputTokens);
  const reported = input.costUSD !== null && input.costUSD !== undefined && Number.isFinite(Number(input.costUSD)) && Number(input.costUSD) >= 0;
  const unpriced = !reported && !!info.unpriced;
  const cost = reported ? Number(input.costUSD) : unpriced ? null : calculateModelCost(info.canonicalName, fresh + cached, output, cached, input.tier);
  const estimated = !!input.estimated;
  return { schemaVersion: 1,
    id: createHash('sha256').update(JSON.stringify([source, input.id])).digest('hex').slice(0, 24),
    source, collection: source, model: String(input.model || info.canonicalName), canonicalModel: info.canonicalName,
    company: info.company, timestamp, date,
    dateBasis: timestamp === null ? input.dateBasis || 'logged-day' : 'logged-timestamp',
    sessionId: input.sessionId ? String(input.sessionId) : null,
    projectPath: canonicalWorkspacePath(input.projectPath) ? input.projectPath.trim() : null,
    granularity: timestamp === null ? 'day-model' : 'request', inputTokens: fresh, cacheReadTokens: cached, cacheWriteTokens: write, outputTokens: output,
    totalTokens: count(input.totalTokens) || fresh + cached + write + output,
    costUSD: cost, recordedCostUSD: cost, currency: 'USD', estimated,
    tokenBasis: estimated ? 'estimated' : 'logged',
    costBasis: unpriced ? 'unpriced' : input.costBasis || (reported ? 'reported' : 'catalog-estimate'),
    costEstimated: estimated || !reported || ['catalog-estimate', 'user-assumed-sol-rate'].includes(input.costBasis), unpriced,
    costComplete: !unpriced && (!write || reported),
    pricingContext: input.pricingContext || null,
    estimation: input.estimation || null,
    speedKnown: !!input.speedKnown,
    quotaReset: Number.isFinite(input.quotaReset) ? input.quotaReset : null };
}

function recordsToDaily(records) {
  const days = new Map();
  for (const record of new Map(records.map(row => [row.id, row])).values()) {
    let day = days.get(record.date);
    if (!day) { day = { date: record.date, period: record.date, agent: record.source, inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, totalCost: 0, calls: 0,
      estimated: false, modelsUsed: [], modelBreakdowns: [] }; days.set(record.date, day); }
    let model = day.modelBreakdowns.find(row => row.modelName === record.model && row.agent === record.source);
    if (!model) { model = { modelName: record.model, rawModel: record.canonicalModel, agent: record.source,
      company: record.company, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      totalTokens: 0, cost: 0, estimated: false, unpriced: false, costEstimated: false };
      day.modelBreakdowns.push(model); if (!day.modelsUsed.includes(record.model)) day.modelsUsed.push(record.model); }
    const input = record.inputTokens + record.cacheReadTokens;
    day.inputTokens += input; day.outputTokens += record.outputTokens; day.cacheReadTokens += record.cacheReadTokens;
    day.cacheCreationTokens += record.cacheWriteTokens; day.totalTokens += record.totalTokens; day.totalCost += record.costUSD ?? 0;
    day.calls++; day.estimated ||= record.estimated;
    model.inputTokens += input; model.outputTokens += record.outputTokens; model.cacheReadTokens += record.cacheReadTokens;
    model.cacheCreationTokens += record.cacheWriteTokens; model.totalTokens += record.totalTokens; model.cost += record.costUSD ?? 0;
    model.estimated ||= record.estimated; model.unpriced ||= record.unpriced; model.costEstimated ||= record.costEstimated;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { createRequestRecord, timestampMs, recordsToDaily };
