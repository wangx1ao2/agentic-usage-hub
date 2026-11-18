'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { COMPANY_CONFIG } = require('../models-pricing');
const { aggregateRecords } = require('./usage-aggregate');
const { canonicalWorkspacePath } = require('./project-path');

function canonicalizeProject(rawPath) {
  const normalized = canonicalWorkspacePath(rawPath);
  if (!normalized) return { key: 'other', name: '未归因用量', icon: '📝' };
  const identity = normalized;
  return { key: 'project_' + createHash('sha256').update(identity).digest('hex').slice(0, 16),
    name: String(rawPath).trim().replace(/\\/g, '/').split('/').filter(Boolean).pop() || normalized, icon: '📁', desc: rawPath };
}

function projectsFromRecords(records, today) {
  const groups = new Map();
  for (const record of new Map(records.map(row => [row.id, row])).values()) {
    const project = canonicalizeProject(record.projectPath);
    if (!groups.has(project.key)) groups.set(project.key, { project, records: [] });
    groups.get(project.key).records.push(record);
  }
  const aliases = { OpenAI: 'openai', Anthropic: 'anthropic', xAI: 'xai', '智谱 AI (Z.ai)': 'zcode',
    'Google (Gemini)': 'gemini', DeepSeek: 'deepseek', 'Qwen (通义千问)': 'qwen' };
  return [...groups.values()].map(({ project, records: rows }) => {
    const aggregate = aggregateRecords(rows, { today });
    const dates = rows.map(row => row.date).filter(Boolean).sort();
    const dateSet = new Set(dates);
    const times = rows.map(row => row.timestamp).filter(Number.isFinite);
    const paths = [...new Set(rows.map(row => row.projectPath).filter(value => canonicalWorkspacePath(value)))];
    const sessions = new Set(rows.filter(row => row.sessionId).map(row => `${row.source}:${row.sessionId}`));
    const companies = Object.fromEntries(Object.entries(aliases).map(([name, key]) => {
      const company = aggregate.companies.find(row => row.name === name);
      return [key, { tokens: company?.totalTokens || 0, cost: company?.totalCost || 0,
        percent: aggregate.totals.totalTokens ? +((company?.totalTokens || 0) / aggregate.totals.totalTokens * 100).toFixed(1) : 0,
        color: COMPANY_CONFIG[name].color }];
    }));
    return { id: project.key, name: project.name, icon: project.icon, desc: project.desc || '',
      primaryPath: paths[0] || '', paths, pathCount: paths.length,
      attribution: paths.length ? 'workspace' : 'unattributed',
      totalTokens: aggregate.totals.totalTokens, totalCost: aggregate.totals.totalCostUSD,
      cacheTokens: aggregate.totals.cacheReadTokens, costComplete: aggregate.totals.costComplete,
      formattedCost: aggregate.totals.formattedCost, formattedTokens: aggregate.totals.formattedTokens,
      estimated: aggregate.totals.estimatedTokens > 0, estimatedTokens: aggregate.totals.estimatedTokens,
      sessionCount: sessions.size, requestCount: rows.filter(row => row.granularity === 'request').length,
      agents: [...new Set(rows.map(row => row.source))], companies,
      topModels: aggregate.models.slice(0, 3).map(row => ({ model: row.modelName, tokens: row.totalTokens })),
      lastActive: dates.at(-1) || '', lastUsageAt: times.length ? new Date(times.reduce((max, time) => Math.max(max, time), -Infinity)).toISOString() : null,
      daily: aggregate.timeline.filter(day => dateSet.has(day.date)).map(day => ({ date: day.date,
        totalTokens: day.totalTokens, totalCost: day.totalCost, cacheReadTokens: day.cacheReadTokens,
        estimatedTokens: day.estimatedTokens })),
      todayTokens: aggregate.today.totalTokens, todayCost: aggregate.today.totalCost,
      costBasis: '共享请求记录与未归因日汇总' };
  }).sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);
}

module.exports = { canonicalizeProject, projectsFromRecords };
