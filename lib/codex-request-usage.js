'use strict';

// Keep request boundaries: applying long-context prices to a daily token sum
// would incorrectly charge every short request at the higher rate.
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const zlib = require('zlib');
const { toDateStr } = require('./date');
const { resolveModelInfo, quoteModelUsage } = require('../models-pricing');
const { buildQuotaHistory } = require('./codex-quota-history');
const { hash, getRuntimeIdentity, snapshotPath, readSnapshot, writeSnapshot } = require('./persistent-cache');
const fileCache = new Map();
let cacheIdentity, cacheFilename, cacheDirty = false, cacheStats = {};
const CODEX_MODEL_NAMES_VERSION = 4;
const REVIEW_PRICING_ID = hash(require('../models-pricing').MODEL_CATALOG['codex-auto-review']);

function priceRequest(model, usage, serviceTier) {
  const input = Number(usage.input_tokens) || 0;
  const cached = Number(usage.cached_input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  const fresh = Math.max(0, input - cached);
  const info = resolveModelInfo(model, 'codex');
  const standardCost = info.unpriced ? null : (fresh * info.pricing.in + cached * info.pricing.cache + output * info.pricing.out) / 1e6;
  const quote = quoteModelUsage(model, { inputTokens:fresh,cacheReadTokens:cached,outputTokens:output },
    { source:'codex',serviceTier,granularity:'request' });
  return { inputTokens: fresh, cacheReadTokens: cached, outputTokens: output,
    standardCost, cost: quote.cost, longContext:quote.longContext, costComplete:quote.costComplete,
    unpriced: quote.unpriced, speedKnown: quote.speedKnown,
    pricingContext: { serviceTier: serviceTier || 'default', speedKnown: quote.speedKnown, longContext:quote.longContext, inputTotal: input,
      policyVersion:quote.policyVersion, issues:quote.issues, evidence:quote.evidence,
      ...(model === 'codex-auto-review' ? { assumedRateModel: info.assumedRateModel || null,
        rateBasis: info.unpriced ? 'unconfigured' : 'user-selected-assumption' } : {}) } };
}

function createRecordParser(fallbackId = 'unknown', options = {}) {
  let model = 'unknown', sessionId = fallbackId, cwd = '', serviceTier = null, appliedServiceTier = null, quota = null;
  const events = [], snapshots = [], seen = new Map();
  let lastKey = null, lastPrune = -Infinity;
  function push(record) {
    if (!record || typeof record !== 'object') return;
    const payload = record.payload || {};
    if (record.type === 'session_meta') {
      sessionId = payload.id || sessionId;
      model = payload.model || model;
      cwd = payload.cwd || cwd;
    }
    if (record.type === 'turn_context') {
      model = payload.model || model;
      // Do not infer historical speed from the user's current configuration.
      serviceTier = payload.service_tier || payload.collaboration_mode?.settings?.service_tier || appliedServiceTier;
    }
    if (record.type === 'event_msg' && payload.type === 'thread_settings_applied'
      && Object.hasOwn(payload.thread_settings || {}, 'service_tier')) {
      appliedServiceTier = payload.thread_settings.service_tier || 'default';
      serviceTier = appliedServiceTier;
    }
    if (record.type !== 'event_msg' || payload.type !== 'token_count') return;
    const timestamp = Date.parse(record.timestamp);
    if (!Number.isFinite(timestamp)) return;
    const limits = payload.rate_limits;
    if (limits && (!limits.limit_id || limits.limit_id === 'codex') && limits.primary?.window_minutes === 300
      && Number.isFinite(limits.primary.used_percent) && limits.primary.resets_at) {
      quota = { observedAt: record.timestamp, timestamp,
        usedPercent: limits.primary.used_percent, resetsAt: limits.primary.resets_at * 1000,
        windowMinutes: 300, planType: limits.plan_type || null };
      snapshots.push(quota);
    }
    const info = payload.info;
    if (!info?.last_token_usage || !info.total_token_usage) return;
    const total = info.total_token_usage;
    const key = `${sessionId}:${JSON.stringify([total.input_tokens, total.cached_input_tokens, total.output_tokens, total.total_tokens])}`;
    const since = options.minTimestamp?.() ?? -Infinity;
    if (since > lastPrune + 1000) {
      for (const [savedKey, time] of seen) if (time < since) seen.delete(savedKey);
      lastPrune = since;
    }
    if (key === lastKey || seen.has(key)) return;
    lastKey = key;
    // Live readers need context and the latest cumulative baseline from old
    // records, but must not retain lifetime request keys or price old usage.
    if (timestamp < since) return;
    seen.set(key, timestamp);
    // Forked chats inherit cumulative totals. Only last_token_usage describes
    // the request made by this chat; reasoning tokens are already in output.
    events.push({ key, timestamp, date: toDateStr(record.timestamp), model, sessionId, cwd,
      // A chat can resume days later without a new five-hour snapshot. Never
      // attach that request to the expired window saved by its previous turn.
      quotaReset: quota && timestamp <= quota.resetsAt + 60_000 ? quota.resetsAt : null,
      ...priceRequest(model, info.last_token_usage, serviceTier) });
  }
  function prune(before) {
    for (const [key, time] of seen) if (time < before) seen.delete(key);
  }
  return { push, events, snapshots, prune, retainedKeys: () => seen.size };
}

function parseRecords(records, fallbackId = 'unknown') {
  const parser = createRecordParser(fallbackId);
  for (const record of records) parser.push(record);
  return { events: parser.events, snapshots: parser.snapshots };
}

async function parseFile(filename, stat) {
  const cached = fileCache.get(filename);
  const fingerprint = [stat.mtimeMs, stat.size, stat.ctimeMs, stat.ino].join(':');
  if (cached?.fingerprint === fingerprint) { cacheStats.reusedFiles++; return cached.result; }
  const parser = createRecordParser(filename);
  const source = fs.createReadStream(filename);
  const input = filename.endsWith('.zst') ? source.pipe(zlib.createZstdDecompress()) : source;
  if (input !== source) source.on('error', error => input.destroy(error));
  input.setEncoding('utf8');
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('"token_count"') && !line.includes('"turn_context"')
        && !line.includes('"session_meta"') && !line.includes('"thread_settings_applied"')) continue;
      try { parser.push(JSON.parse(line)); } catch (_) { /* Incomplete live tail. */ }
    }
    const result = { events: parser.events, snapshots: parser.snapshots };
    fileCache.set(filename, { fingerprint, result });
    cacheDirty = true; cacheStats.parsedFiles++; cacheStats.bytesRead += stat.size;
    return result;
  } finally {
    lines.close();
    input.destroy();
    source.destroy();
  }
}

async function findFiles(roots) {
  const files = [], visited = new Set();
  async function visit(directory) {
    let real;
    try { real = await fs.promises.realpath(directory); } catch (_) { return; }
    if (visited.has(real)) return;
    visited.add(real);
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && (entry.name.endsWith('.jsonl')
        || (entry.name.endsWith('.jsonl.zst') && typeof zlib.createZstdDecompress === 'function'))) files.push(filename);
    }
  }
  for (const root of roots) await visit(root);
  return files;
}

function restoreAutoReviewModels(data, events) {
  if (data.requestReadErrors) return;
  const byDate = new Map();
  for (const event of events) {
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }
  const fields = ['inputTokens', 'cacheReadTokens', 'outputTokens'];
  const sum = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  const matches = (left, right) => fields.every(field => sum(left, field) === sum(right, field));
  for (const day of data.daily || []) {
    const requests = byDate.get(day.date || day.period) || [];
    const breakdowns = day.modelBreakdowns?.length ? day.modelBreakdowns
      : Object.entries(day.models || {}).map(([modelName, row]) => ({ ...row, modelName, agent: 'codex', cost: row.cost ?? row.costUSD }));
    const native = breakdowns.filter(row => row.agent === 'codex');
    if (!requests.some(row => row.model === 'codex-auto-review') || !native.length) continue;
    // ccusage can fold the opaque reviewer ID into its default GPT model.
    // Restore raw IDs only with complete, exactly matching token coverage.
    if (native.some(row => Number(row.cacheCreationTokens) > 0) || !matches(native, requests)) continue;
    const groups = new Map();
    for (const request of requests) {
      if (!groups.has(request.model)) groups.set(request.model, []);
      groups.get(request.model).push(request);
    }
    const restored = [];
    for (const [modelName, rows] of groups) {
      const existing = native.filter(row => row.modelName === modelName);
      // Keep established prices for correctly attributed model groups.
      if (existing.length && existing.every(row => Number.isFinite(row.cost))
        && matches(existing, rows) && modelName !== 'codex-auto-review') {
        restored.push(...existing);
        continue;
      }
      const counts = Object.fromEntries(fields.map(field => [field, sum(rows, field)]));
      restored.push({ modelName, agent: 'codex', ...counts, cacheCreationTokens: 0,
        totalTokens: fields.reduce((total, field) => total + counts[field], 0),
        cost: rows.reduce((total, row) => total + (row.unpriced ? 0 : row.cost || 0), 0),
        unpriced: rows.some(row => row.unpriced) });
    }
    day.modelBreakdowns = [...breakdowns.filter(row => row.agent !== 'codex'), ...restored];
    delete day.models;
    day.modelsUsed = [...new Set(day.modelBreakdowns.map(row => row.modelName))];
    day.totalCost = day.modelBreakdowns.reduce((total, row) => total + (Number(row.cost) || 0), 0);
  }
}

function applyRequestPricing(data, results) {
  const unique = new Map(), snapshots = [];
  for (const result of results) {
    for (const event of result.events) unique.set(event.key, event);
    snapshots.push(...result.snapshots);
  }
  // Persisted aggregates can contain events priced by an earlier catalog/rule
  // version. Requote their disjoint components without changing request IDs.
  const events = [...unique.values()].map(event => ({ ...event, ...priceRequest(event.model, {
      input_tokens: event.inputTokens + event.cacheReadTokens,
      cached_input_tokens: event.cacheReadTokens, output_tokens: event.outputTokens },
      event.pricingContext?.serviceTier === 'default' && !event.speedKnown ? null : event.pricingContext?.serviceTier || null) }))
    .sort((a, b) => a.timestamp - b.timestamp);
  restoreAutoReviewModels(data, events);
  const byModelDate = new Map();
  for (const event of events) {
    const key = `${event.date}:${event.model}`;
    if (!byModelDate.has(key)) byModelDate.set(key, []);
    byModelDate.get(key).push(event);
  }
  for (const day of data.daily || []) {
    for (const breakdown of day.modelBreakdowns || []) {
      delete breakdown.requestPricing;
      if (breakdown.agent !== 'codex') continue;
      const rows = byModelDate.get(`${day.date || day.period}:${breakdown.modelName}`) || [];
      let input = 0, cached = 0, output = 0, cost = 0, longRequests = 0, unknownSpeed = 0, unpriced = false, complete = true;
      const issues = new Set();
      for (const row of rows) {
        input += row.inputTokens; cached += row.cacheReadTokens; output += row.outputTokens;
        cost += row.cost || 0; longRequests += Number(row.longContext); unknownSpeed += Number(!row.speedKnown);
        unpriced ||= row.unpriced; complete &&= row.costComplete !== false;
        for (const issue of row.pricingContext?.issues || []) issues.add(issue);
        // ccusage may have captured an earlier prefix while a chat is active.
        // Apply the correction only to an exactly matching token snapshot.
        if (input === breakdown.inputTokens && cached === breakdown.cacheReadTokens && output === breakdown.outputTokens) {
          breakdown.requestPricing = { cost: unpriced ? null : +cost.toFixed(6), unpriced, costComplete:complete && !unpriced,
            issues:[...issues],longContextRequests: longRequests,
            unknownSpeedRequests: unknownSpeed, basis: 'request-context-standard-speed-fallback' };
          break;
        }
        if (input > breakdown.inputTokens || cached > breakdown.cacheReadTokens || output > breakdown.outputTokens) break;
      }
    }
  }
  data.codexQuota = buildQuotaHistory(events, snapshots);
  data.requestRecords = events;
  data.quotaSnapshots = snapshots;
  data._codexModelNamesVersion = CODEX_MODEL_NAMES_VERSION;
  data._reviewPricingIdentity = REVIEW_PRICING_ID;
  return data;
}

async function enrichCodexUsage(data, options = {}) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const roots = options.roots || [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  const identity = hash([getRuntimeIdentity(), roots]);
  if (identity !== cacheIdentity) {
    fileCache.clear(); cacheDirty = false; cacheIdentity = identity;
    cacheFilename = snapshotPath('codex-requests', identity);
    const saved = readSnapshot(cacheFilename, identity);
    if (Array.isArray(saved) && saved.every(row => Array.isArray(row) && typeof row[0] === 'string'
      && typeof row[1]?.fingerprint === 'string' && Array.isArray(row[1].result?.events) && Array.isArray(row[1].result?.snapshots))) {
      for (const [filename, entry] of saved) fileCache.set(filename, entry);
    }
  }
  cacheStats = { restoredFiles: fileCache.size, reusedFiles: 0, parsedFiles: 0, bytesRead: 0 };
  const files = await findFiles(roots);
  const results = [];
  let readErrors = 0;
  let index = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (index < files.length) {
      const filename = files[index++];
      try {
        const stat = await fs.promises.stat(filename);
        results.push(await parseFile(filename, stat));
      }
      catch (_) { readErrors++; }
    }
  }));
  const active = new Set(files);
  for (const filename of fileCache.keys()) if (!active.has(filename)) { fileCache.delete(filename); cacheDirty = true; }
  if (cacheDirty) {
    cacheStats.persistenceError = writeSnapshot(cacheFilename, identity, [...fileCache]);
    if (!cacheStats.persistenceError) cacheDirty = false;
  }
  data.requestReadErrors = readErrors;
  data.requestIndex = { ...cacheStats };
  return applyRequestPricing(data, results);
}

module.exports = { enrichCodexUsage, parseRecords, createRecordParser, applyRequestPricing, priceRequest, CODEX_MODEL_NAMES_VERSION };
