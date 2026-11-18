'use strict';

require('./config');
const path = require('node:path');
const fs = require('node:fs');
const { cacheDir } = require('./config');
const { hash } = require('./persistent-cache');
const { createSourceIndex } = require('./source-index');
const { createRequestRecord } = require('./request-record');
const { canonicalWorkspacePath } = require('./project-path');
const { priceRequest } = require('./codex-request-usage');

function configuredProjects() {
  return [...new Set((process.env.BUSINESS_API_PROJECTS || '').split(path.delimiter)
    .map(value => value.trim()).filter(value => canonicalWorkspacePath(value)).map(value => path.resolve(value)))];
}

function apiRecord(row, projectPath) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.requestId !== 'string'
    || !row.requestId || typeof row.model !== 'string' || !row.model
    || (row.costUSD != null && (typeof row.costUSD !== 'number' || !Number.isFinite(row.costUSD) || row.costUSD < 0))) return null;
  const usage = row.usage || {};
  const input = usage.prompt_tokens ?? usage.input_tokens;
  const output = usage.completion_tokens ?? usage.output_tokens;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens
    ?? usage.cached_input_tokens ?? usage.prompt_cache_hit_tokens;
  if (!row.requestId || !row.model || ![input, output].every(value => Number.isSafeInteger(value) && value >= 0)
    || (cached !== undefined && (!Number.isSafeInteger(cached) || cached < 0 || cached > input))) return null;
  const total = usage.total_tokens ?? input + output;
  if (total !== input + output) return null;
  const billingMode = row.billingMode || (row.requestId.startsWith('chatcmpl-codex-') ? 'chatgpt-subscription' : 'api');
  const priced = priceRequest(row.model, { input_tokens: input, cached_input_tokens: cached || 0,
    output_tokens: output }, row.serviceTier || row.service_tier);
  const record = createRequestRecord({ source: 'api', id: [canonicalWorkspacePath(projectPath), row.requestId],
    rawModel: row.model, model: `${row.model} (业务 API)`, timestamp: row.timestamp,
    projectPath, sessionId: row.requestId,
    inputTokens: input - (cached || 0), cacheReadTokens: cached || 0, outputTokens: output, totalTokens: total,
    costUSD: row.costUSD ?? (priced.unpriced ? undefined : +priced.cost.toFixed(6)),
    costBasis: row.costUSD == null ? 'catalog-estimate' : 'reported', speedKnown: priced.speedKnown,
    pricingContext: { ...priced.pricingContext, usageOrigin: 'business-api', billingMode, cacheKnown: cached !== undefined,
      cacheAssumption: cached === undefined ? 'all-input-fresh' : null },
    estimation: cached === undefined && row.costUSD == null ? { method: 'unknown-cache-split',
      note: 'Token 来自业务响应日志；费用将全部输入按未命中缓存估算，可能偏高。' } : null });
  return record;
}

function parseBusinessApiLog(content, filename, projectPath) {
  const records = [], lines = content.split('\n');
  let parseErrors = 0, pendingLines = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const structured = filename.endsWith('.jsonl');
    if (!structured && !line.includes('AI响应:')) continue;
    // A writer can leave a partial line at EOF. Do not publish it as usage.
    if (index === lines.length - 1 && !content.endsWith('\n')) { pendingLines++; continue; }
    let row;
    if (structured) {
      try { row = JSON.parse(line); } catch (_) { parseErrors++; continue; }
    } else {
      const match = line.match(/AI响应: id=([^,\s]+), time=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}), model=([^,\s]+), promptTokens=(-?\d+), completionTokens=(-?\d+), totalTokens=(-?\d+)/);
      if (!match) { parseErrors++; continue; }
      row = { requestId: match[1], timestamp: match[2].replace(' ', 'T'), model: match[3],
        usage: { prompt_tokens: Number(match[4]), completion_tokens: Number(match[5]), total_tokens: Number(match[6]) } };
      const cache = line.match(/, cachedTokens=(\d+)/);
      if (cache) row.usage.prompt_tokens_details = { cached_tokens: Number(cache[1]) };
    }
    const record = apiRecord(row, projectPath);
    if (record) records.push(record); else parseErrors++;
  }
  return { records, parseErrors, pendingLines };
}

function createBusinessApiMonitor({ projects = configuredProjects, ledgerDir = path.join(cacheDir, 'business-api'), ...options } = {}) {
  let currentProjects = [];
  const projectFor = filename => currentProjects.filter(root => filename.startsWith(root + path.sep)).sort((a, b) => b.length - a.length)[0];
  const index = createSourceIndex({ ...options, source: 'api', ttlMs: 10_000,
    paths: () => {
      currentProjects = projects();
      return currentProjects.flatMap(project => [path.join(project, '.local'), path.join(project, 'logs')]);
    },
    accept: filename => {
      const project = projectFor(filename);
      return project && !/(?:^|[\\/])(?:backups|[^\\/]*tests|model-comparison)(?:[\\/])/i.test(path.relative(project, filename))
        && (filename.endsWith('.log') || path.basename(filename) === 'ai-usage.jsonl');
    },
    parse: (content, filename) => {
      const project = projectFor(filename);
      return project ? parseBusinessApiLog(content, filename, project) : { records: [], parseErrors: 1 };
    } });
  let records = [], ledgerError = null;
  const strength = row => row.costBasis === 'reported' ? 2 : row.pricingContext?.cacheKnown ? 1 : 0;
  return {
    getRecords(force = false) {
      const observed = index.getRecords(force);
      const unique = new Map();
      ledgerError = null;
      const identity = currentProjects.map(root => canonicalWorkspacePath(root)).sort();
      const ledger = path.join(ledgerDir, `${hash(['business-api', 1, identity])}.jsonl`);
      // Keep observed requests after application logs rotate or are truncated.
      // Append-only metadata also lets HTTP and MCP writers coexist safely.
      try {
        const content = fs.readFileSync(ledger, 'utf8');
        if (content && !content.endsWith('\n')) throw new Error('Business API ledger has an incomplete tail');
        for (const line of content.split('\n').filter(Boolean)) {
          const row = JSON.parse(line);
          if (row.source !== 'api' || !identity.includes(canonicalWorkspacePath(row.projectPath)) || !row.id) throw new Error('Invalid business API ledger row');
          if (!unique.has(row.id) || strength(row) > strength(unique.get(row.id))) unique.set(row.id, row);
        }
      } catch (error) { if (error.code !== 'ENOENT') ledgerError = error.message; }
      if (ledgerError) for (const row of records) {
        if (identity.includes(canonicalWorkspacePath(row.projectPath)) && !unique.has(row.id)) unique.set(row.id, row);
      }
      const additions = [];
      for (const row of observed) {
        if (!unique.has(row.id) || strength(row) > strength(unique.get(row.id))) {
          unique.set(row.id, row);
          additions.push(row);
        }
      }
      if (additions.length && !ledgerError && identity.length) {
        try {
          fs.mkdirSync(ledgerDir, { recursive: true });
          fs.appendFileSync(ledger, additions.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
        } catch (error) { ledgerError = error.message; }
      }
      records = [...unique.values()];
      return records;
    },
    getDiagnostics: () => {
      const status = index.getDiagnostics(), dates = records.map(row => row.date).sort();
      return { ...status, status: status.stale || ledgerError ? 'partial' : records.length ? 'ready' : status.status,
        ...(ledgerError ? { stale: true, error: ledgerError, readErrors: (status.readErrors || 0) + 1 } : {}),
        available: status.available || records.length > 0, configuredProjects: [...currentProjects],
        coverage: { from: dates[0] || null, to: dates.at(-1) || null },
        requests: records.length, cacheSplitUnknownRequests: records.filter(row => !row.pricingContext.cacheKnown).length,
        costNotice: '业务 API 金额为日志金额或目录价估算；缺少缓存拆分时按全部新输入估算，可能偏高。ChatGPT 桥接金额为 API 等值，非额外 API 扣款。' };
    },
    invalidate: () => index.invalidate()
  };
}

module.exports = { apiRecord, configuredProjects, parseBusinessApiLog, createBusinessApiMonitor };
