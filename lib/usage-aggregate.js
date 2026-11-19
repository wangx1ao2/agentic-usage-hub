'use strict';

const { COMPANY_CONFIG } = require('../models-pricing');
const { getLocalDateStr } = require('./date');
const { matchesSource } = require('./usage-record');
const money = value => +value.toFixed(6);
const dict = () => Object.create(null);
const metric = () => ({ cost: 0, tokens: 0, cacheTokens: 0, estimatedTokens: 0, unpricedTokens: 0 });

function addMetric(target, record) {
  target.cost += record.costUSD ?? 0;
  target.tokens += record.totalTokens;
  target.cacheTokens += record.cacheReadTokens;
  target.estimatedTokens += record.estimated ? record.totalTokens : 0;
  target.unpricedTokens += record.unpriced ? record.totalTokens : record.unpricedTokens ?? (record.costComplete === false ? record.cacheWriteTokens : 0);
}
function addModel(map, record) {
  const row = map[record.model] ||= { ...metric(), agent: record.source, agents: [], company: record.company,
    bySource: dict(), estimated: false, costEstimated: false, unpriced: false, costComplete: true };
  addMetric(row, record);
  if (!row.agents.includes(record.source)) row.agents.push(record.source);
  row.agent = row.agents.length === 1 ? row.agents[0] : 'mixed';
  const source = row.bySource[record.source] ||= { ...metric(), agent: record.source, company: record.company };
  addMetric(source, record);
  row.estimated ||= record.estimated;
  row.costEstimated ||= record.costEstimated;
  row.unpriced ||= record.unpriced;
  row.costComplete &&= record.costComplete !== false && !record.unpriced;
}

function aggregateRecords(records, { agent = 'all', actualOnly = false, today = getLocalDateStr() } = {}) {
  const unique = new Map(records.map(record => [record.id, record]));
  const visible = [...unique.values()].filter(record => matchesSource(record, agent) && (!actualOnly || !record.estimated));
  const days = new Map(), models = dict(), companies = dict(), agents = dict();
  function ensureDay(date) {
    if (!days.has(date)) days.set(date, { date, totalCost: 0, totalTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0, estimatedTokens: 0, unpricedTokens: 0,
      agents: [], byCompany: Object.assign(dict(), Object.fromEntries(Object.keys(COMPANY_CONFIG).map(name => [name, { ...metric(), models: [] }]))), byModel: dict() });
    return days.get(date);
  }
  ensureDay(today);
  for (const record of visible) {
    const day = ensureDay(record.date);
    day.totalCost += record.costUSD ?? 0;
    day.totalTokens += record.totalTokens;
    day.cacheReadTokens += record.cacheReadTokens;
    day.cacheWriteTokens += record.cacheWriteTokens;
    day.inputTokens += record.inputTokens;
    day.outputTokens += record.outputTokens;
    day.estimatedTokens += record.estimated ? record.totalTokens : 0;
    day.unpricedTokens += record.unpriced ? record.totalTokens : record.unpricedTokens ?? (record.costComplete === false ? record.cacheWriteTokens : 0);
    if (!day.agents.includes(record.source)) day.agents.push(record.source);
    addModel(day.byModel, record);
    addModel(models, record);
    const company = day.byCompany[record.company] ||= { ...metric(), models: [] };
    addMetric(company, record);
    if (!company.models.includes(record.model)) company.models.push(record.model);
    const companyTotal = companies[record.company] ||= { ...metric(), dates: new Set() };
    addMetric(companyTotal, record);
    companyTotal.dates.add(record.date);
    const source = agents[record.source] ||= { ...metric(), dates: new Set() };
    addMetric(source, record);
    source.dates.add(record.date);
  }
  const timeline = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of timeline) day.totalCost = money(day.totalCost);
  const totalCost = money(timeline.reduce((sum, day) => sum + day.totalCost, 0));
  const totalTokens = timeline.reduce((sum, day) => sum + day.totalTokens, 0);
  const cached = timeline.reduce((sum, day) => sum + day.cacheReadTokens, 0);
  const estimatedTokens = timeline.reduce((sum, day) => sum + day.estimatedTokens, 0);
  const unpricedTokens = timeline.reduce((sum, day) => sum + day.unpricedTokens, 0);
  const totals = { totalCostUSD: totalCost, totalTokens, cacheReadTokens: cached,
    cacheRate: totalTokens ? +(cached / totalTokens * 100).toFixed(1) : 0,
    thisMonthCost: money(timeline.filter(day => day.date.startsWith(today.slice(0, 7))).reduce((sum, day) => sum + day.totalCost, 0)),
    estimatedTokens, estimatedShare: totalTokens ? estimatedTokens / totalTokens : 0,
    unpricedTokens, costComplete: unpricedTokens === 0 && visible.every(record => record.costComplete !== false),
    formattedCost: '$' + totalCost.toFixed(2), formattedTokens: (totalTokens / 1e6).toFixed(1) + 'M', formattedCacheTokens: (cached / 1e6).toFixed(1) + 'M' };
  const rankings = Object.entries(models).map(([modelName, row]) => ({ ...row, modelName,
    totalCost: money(row.cost), totalTokens: row.tokens, formattedCost: '$' + row.cost.toFixed(2), formattedTokens: (row.tokens / 1e6).toFixed(1) + 'M' }))
    .sort((a, b) => b.totalCost - a.totalCost);
  const companyNames = [...new Set([...Object.keys(COMPANY_CONFIG), ...Object.keys(companies)])];
  const companyList = companyNames.map(name => {
    const config = Object.hasOwn(COMPANY_CONFIG, name) ? COMPANY_CONFIG[name] : { label: name, color: '#64748b', agentKey: 'other' };
    const row = companies[name] || { ...metric(), dates: new Set() };
    return { ...config, name, totalCost: money(row.cost), totalTokens: row.tokens, cacheTokens: row.cacheTokens,
      activeDays: row.dates.size, status: row.tokens ? 'active' : 'standby',
      formattedCost: '$' + row.cost.toFixed(2), formattedTokens: (row.tokens / 1e6).toFixed(1) + 'M' };
  }).sort((a, b) => b.totalCost - a.totalCost);
  const agentBreakdown = Object.fromEntries(['codex', 'claude', 'grok', 'zcode', 'antigravity', 'openclaw', 'reasonix', 'qwen', 'qoderwork', 'api'].map(source => {
    const row = agents[source] || { ...metric(), dates: new Set() };
    return [source, { totalCost: money(row.cost), totalTokens: row.tokens, days: row.dates.size, estimated: row.estimatedTokens > 0 }];
  }));
  return { timeline, totals, models: rankings, companies: companyList, agentBreakdown, today: ensureDay(today) };
}

module.exports = { aggregateRecords };
