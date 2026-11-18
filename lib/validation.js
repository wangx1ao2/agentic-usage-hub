'use strict';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid(message) { const error = new Error(message); error.code = -32602; throw error; }
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validateToolArguments(name, args = {}) {
  if (!isObject(args)) invalid('arguments must be an object');
  const schemas = {
    get_usage_today: ['tier'], get_usage_range: ['startDate', 'endDate', 'groupBy', 'tier', 'agent'],
    get_project_breakdown: ['limit', 'startDate', 'endDate', 'tier', 'agent']
  };
  const allowed = Object.hasOwn(schemas, name) ? schemas[name] : undefined;
  if (!allowed) return args;
  allowed.push('actualOnly', 'pricingMode', 'pricingVersion');
  if (Object.keys(args).some(key => !allowed.includes(key))) invalid('Unknown argument');
  if (args.tier !== undefined && !['standard', 'flagship'].includes(args.tier)) invalid('tier must be standard or flagship');
  for (const key of ['startDate', 'endDate']) if (args[key] !== undefined && !isDate(args[key])) invalid(`${key} must be a valid YYYY-MM-DD date`);
  if (args.startDate && args.endDate && args.startDate > args.endDate) invalid('startDate must not be after endDate');
  if (args.groupBy !== undefined && !['company', 'model'].includes(args.groupBy)) invalid('groupBy must be company or model');
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 50)) invalid('limit must be an integer between 1 and 50');
  if (args.actualOnly !== undefined && typeof args.actualOnly !== 'boolean') invalid('actualOnly must be boolean');
  if (args.pricingMode !== undefined && !['recorded', 'current'].includes(args.pricingMode)) invalid('Invalid pricingMode');
  if (args.pricingVersion !== undefined && (typeof args.pricingVersion !== 'string' || !/^catalog-[a-f0-9]{24}$/.test(args.pricingVersion) || args.pricingMode !== 'current')) invalid('Invalid pricingVersion');
  if (args.agent !== undefined && !['all', 'codex', 'claude', 'grok', 'zcode', 'qwen', 'qoderwork', 'antigravity', 'openclaw', 'reasonix', 'api'].includes(args.agent)) invalid('Invalid agent');
  return args;
}

function parseUsageFilters(params) {
  const filters = {};
  for (const field of ['startDate', 'endDate']) {
    if (params.has(field)) { if (!isDate(params.get(field))) invalid(`Invalid ${field}`); filters[field] = params.get(field); }
  }
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) invalid('startDate must not be after endDate');
  if (params.has('agent')) {
    if (!['all', 'codex', 'claude', 'grok', 'zcode', 'qwen', 'qoderwork', 'antigravity', 'openclaw', 'reasonix', 'api'].includes(params.get('agent'))) invalid('Invalid agent');
    filters.agent = params.get('agent');
  }
  if (params.has('tier')) {
    if (!['standard', 'flagship'].includes(params.get('tier'))) invalid('Invalid tier');
    filters.tier = params.get('tier');
  }
  if (params.has('actualOnly')) {
    if (!['true', 'false'].includes(params.get('actualOnly'))) invalid('Invalid actualOnly');
    filters.actualOnly = params.get('actualOnly') === 'true';
  }
  if (params.has('pricingMode')) {
    if (!['recorded', 'current'].includes(params.get('pricingMode'))) invalid('Invalid pricingMode');
    filters.pricingMode = params.get('pricingMode');
  }
  if (params.has('pricingVersion')) {
    if (!/^catalog-[a-f0-9]{24}$/.test(params.get('pricingVersion'))) invalid('Invalid pricingVersion');
    filters.pricingVersion = params.get('pricingVersion');
    if (filters.pricingMode !== 'current') invalid('A pricingVersion requires recalculation mode');
  }
  if (params.has('projectId')) {
    if (!/^(?:other|project_[a-f0-9]{16})$/.test(params.get('projectId'))) invalid('Invalid projectId');
    filters.projectId = params.get('projectId');
  }
  for (const [field, min, max] of [['offset', 0, Number.MAX_SAFE_INTEGER], ['limit', 1, 500]]) {
    if (!params.has(field)) continue;
    const raw = params.get(field), value = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`Invalid ${field}`);
    filters[field] = value;
  }
  return filters;
}

module.exports = { isObject, isDate, validateToolArguments, parseUsageFilters };
