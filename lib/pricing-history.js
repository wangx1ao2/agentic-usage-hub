'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { MODEL_CATALOG } = require('../models-pricing');
const { quoteCatalogUsage } = require('./pricing-rules');
const { cacheDir } = require('./config');
const { threadId } = require('node:worker_threads');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

function validPolicy(policy) {
  if (policy === undefined) return true; // Catalogs captured before policy metadata.
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!object(policy) || policy.version !== 1 || !object(policy.serviceTiers)) return false;
  if (Object.values(policy.serviceTiers).some(tier => !number(tier)
    && !(object(tier) && ['input','cache','output','cacheWrite'].every(field => number(tier[field]))))) return false;
  if (policy.context !== undefined && !(object(policy.context) && number(policy.context.above)
    && ['input','cache','output'].every(field => number(policy.context[field])))) return false;
  if (policy.inputBands !== undefined && !(Array.isArray(policy.inputBands) && policy.inputBands.every(band => object(band)
    && number(band.above) && object(band.rates) && ['in','cache','out'].every(field => number(band.rates[field]))))) return false;
  if (policy.cacheWriteMultipliers !== undefined && !(object(policy.cacheWriteMultipliers)
    && number(policy.cacheWriteMultipliers.short) && number(policy.cacheWriteMultipliers.long))) return false;
  return policy.validThrough === undefined || /^\d{4}-\d{2}-\d{2}$/.test(policy.validThrough);
}

function validateHistory(saved) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(saved) || saved.schemaVersion !== 1 || !object(saved.snapshots) || !object(saved.records)
    || Object.entries(saved.snapshots).some(([key, row]) => !/^catalog-[a-f0-9]{24}$/.test(key)
      || !object(row) || !object(row.rates) || row.id !== key || key !== 'catalog-' + hash(row.rates)
      || Object.values(row.rates).some(rates => !object(rates) || !validPolicy(rates.pricingPolicy) || ['standard', 'flagship'].some(tier => !object(rates[tier])
        || ['in', 'out', 'cache'].some(field => typeof rates[tier][field] !== 'number' || !Number.isFinite(rates[tier][field]) || rates[tier][field] < 0))))
    || Object.entries(saved.records).some(([key, row]) => !/^[a-f0-9]{24}$/.test(key) || !object(row)
      || !(row.costUSD === null || typeof row.costUSD === 'number' && Number.isFinite(row.costUSD) && row.costUSD >= 0)
      || !(row.version === 'reported' || Object.hasOwn(saved.snapshots, row.version)))) throw new Error('Unsupported or corrupt pricing history');
  return saved;
}

function releasePricingLockForThread(exitedThreadId, directory = path.join(cacheDir, 'pricing')) {
  const filename = path.join(directory, 'history.lock');
  try {
    const owner = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (owner.pid === process.pid && owner.threadId === exitedThreadId) fs.unlinkSync(filename);
  } catch (_) { /* Only a verified matching owner may be removed. */ }
}

function createPricingHistory({ directory = path.join(cacheDir, 'pricing'), catalog = MODEL_CATALOG,
  now = () => new Date().toISOString() } = {}) {
  const filename = path.join(directory, 'history.json');
  let history = { schemaVersion: 1, snapshots: {}, records: {} }, error = null, dirty = false, readable = true;
  try {
    history = validateHistory(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch (cause) { if (cause.code !== 'ENOENT') { readable = false; error = '价格历史无法读取；保留原文件，仅提供当前费率重算。'; } }
  const rates = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(catalog).map(([model, row]) => [model, {
    standard: row.standard, flagship: row.flagship || row.standard,
    ...(row.pricingPolicy ? { pricingPolicy:row.pricingPolicy } : {}),
    ...(row.pricingEvidence ? { pricingEvidence:row.pricingEvidence } : {}),
    ...(row.unpriced ? { unpriced: true } : {}), ...(row.assumedRateModel ? { assumedRateModel: row.assumedRateModel } : {}) }]))));
  const id = 'catalog-' + hash(rates);
  if (!history.snapshots[id]) {
    history.snapshots[id] = { id, capturedAt: now(), currency: 'USD', unit: 'per-million-tokens',
      basis: 'bundled-catalog-at-index-time', rates };
    dirty = true;
  }
  function persist() {
    if (!dirty || !readable) return;
    const lockPath = path.join(directory, 'history.lock');
    let lock;
    try {
      fs.mkdirSync(directory, { recursive: true });
      try { lock = fs.openSync(lockPath, 'wx'); }
      catch (cause) {
        if (cause.code !== 'EEXIST') throw cause;
        const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        let alive = true;
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        }
        if (alive) throw new Error('Pricing history is being updated by another process');
        fs.unlinkSync(lockPath);
        lock = fs.openSync(lockPath, 'wx');
      }
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, threadId }));
      // Merge under the exclusive lock: first recorded observations win, and a
      // second HTTP/MCP instance cannot erase another instance's saved prices.
      try {
        const latest = validateHistory(JSON.parse(fs.readFileSync(filename, 'utf8')));
        history.snapshots = { ...history.snapshots, ...latest.snapshots };
        history.records = { ...history.records, ...latest.records };
      } catch (cause) {
        if (cause.code !== 'ENOENT') { readable = false; error = '价格历史无法读取；保留原文件，仅提供当前费率重算。'; return; }
      }
      const temporary = `${filename}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(history));
      fs.renameSync(temporary, filename);
      dirty = false;
      error = null;
    } catch (_) { error = '价格历史暂无法写入或正被其他实例更新；本次捕获仅保存在内存中，可重试。'; }
    finally {
      if (lock !== undefined) { fs.closeSync(lock); try { fs.unlinkSync(lockPath); } catch (_) {} }
    }
  }
  function quote(record, snapshot, tier, asOf) {
    const row = Object.hasOwn(snapshot.rates, record.canonicalModel) ? snapshot.rates[record.canonicalModel]
      : record.canonicalModel === 'codex-auto-review' && (record.pricingContext?.assumedRateModel || record.costBasis === 'user-assumed-sol-rate')
        ? snapshot.rates[record.pricingContext?.assumedRateModel || 'gpt-6.1-sol'] : null;
    const context = record.pricingContext;
    const rateModel = row?.assumedRateModel || (record.canonicalModel === 'codex-auto-review'
      ? context?.assumedRateModel || 'gpt-6.1-sol' : record.canonicalModel);
    const result = quoteCatalogUsage(row, rateModel, record, { source:record.source,
      tier:record.source === 'zcode' ? tier : 'standard', granularity:record.granularity,
      serviceTier:context?.serviceTier, cacheWrite:context?.cacheWrite, asOf:asOf || now() });
    return { ...result, cost:result.cost === null ? null : +result.cost.toFixed(6) };
  }
  function calculate(record, snapshot, tier) { return quote(record, snapshot, tier).cost; }
  function apply(records, { pricingMode = 'recorded', pricingVersion, tier = 'standard' } = {}) {
    if (pricingMode === 'recorded' && pricingVersion) throw Object.assign(new Error('A catalog version requires current/recalculation mode'), { statusCode: 400 });
    const selected = history.snapshots[pricingVersion || id];
    if (!selected || !Object.hasOwn(history.snapshots, pricingVersion || id)) throw Object.assign(new Error('Unknown pricing version'), { statusCode: 400 });
    const captures = [];
    const output = records.map(record => {
      const reviewerEstimate = record.canonicalModel === 'codex-auto-review' && record.costBasis !== 'reported';
      const captureKey = basis => hash([record.id, tier, record.inputTokens, record.cacheReadTokens, record.cacheWriteTokens,
        record.outputTokens, record.totalTokens, basis, basis === 'reported' ? record.costUSD : null]);
      // A changed/disabled assumption is a new catalog, not a new observation.
      // Keep compatibility with the original Sol capture key and earlier nulls.
      const estimate = record.costBasis !== 'reported';
      const key = captureKey(reviewerEstimate ? 'user-assumed-sol-rate' : estimate ? 'catalog-estimate' : record.costBasis);
      let saved = history.records[key];
      if (!saved && estimate) {
        saved = [...new Set(['unpriced', 'user-assumed-model-rate',record.costBasis])].map(basis => history.records[captureKey(basis)])
          .filter(Boolean).sort((a,b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))[0];
        if (saved) { history.records[key] = saved; dirty = true; }
      }
      captures.push(key);
      if (!saved) {
        saved = { costUSD: record.costUSD, unpriced: record.unpriced, costComplete: record.costUSD !== null && record.costComplete !== false,
          version: record.costBasis === 'reported' ? 'reported' : id, capturedAt: now(), costBasis: record.costBasis,
          costEstimated:record.costEstimated, pricingContext: record.pricingContext };
        history.records[key] = saved; dirty = true;
      }
      const recorded = pricingMode === 'recorded' && readable;
      // An explicitly selected snapshot is replayed at its capture date. Current
      // mode checks today's expiry; recorded mode always retains the capture.
      const recalculated = recorded ? null : quote(record, selected, tier, pricingVersion ? selected.capturedAt : now());
      const costUSD = recorded ? saved.costUSD : recalculated.cost;
      const reviewRate = selected.rates[record.canonicalModel];
      return { ...record, costUSD, recordedCostUSD: saved.costUSD,
        ...(!recorded ? { pricingContext:{ ...record.pricingContext, longContext:recalculated.longContext,
          inputTotal:recalculated.inputTotal, policyVersion:recalculated.policyVersion,
          issues:recalculated.issues,evidence:recalculated.evidence } } : {}),
        ...(reviewerEstimate && !recorded ? { pricingContext: { ...record.pricingContext,
          longContext:recalculated.longContext,inputTotal:recalculated.inputTotal,policyVersion:recalculated.policyVersion,
          issues:recalculated.issues,evidence:recalculated.evidence,
          assumedRateModel: reviewRate ? reviewRate.unpriced ? null : reviewRate.assumedRateModel || 'gpt-6.1-sol'
            : record.pricingContext?.assumedRateModel || (record.costBasis === 'user-assumed-sol-rate' ? 'gpt-6.1-sol' : null),
          rateBasis: costUSD === null ? 'unconfigured' : 'user-selected-assumption' } } : {}),
        unpriced: costUSD === null,
        costComplete: recorded ? saved.costComplete : recalculated.costComplete,
        costBasis: recorded ? saved.costBasis : costUSD === null ? 'unpriced' : 'catalog-recalculation',
        costEstimated: recorded ? saved.costEstimated ?? record.costEstimated : true,
        pricingVersion: recorded ? saved.version : selected.id,
        priceCapturedAt: saved.capturedAt, pricingHistoryUnavailable: !!error };
    });
    persist();
    return output.map((row, index) => {
      const saved = history.records[captures[index]];
      if (!readable) {
        const recalculated = quote(records[index], selected, tier, pricingVersion ? selected.capturedAt : now());
        const cost = recalculated.cost;
        return { ...row, costUSD: cost, recordedCostUSD: saved.costUSD, unpriced: cost === null,
          costBasis: cost === null ? 'unpriced' : 'catalog-recalculation', pricingVersion: selected.id,
          pricingHistoryUnavailable: true, costComplete: recalculated.costComplete };
      }
      if (pricingMode === 'recorded') return { ...row, costUSD: saved.costUSD, recordedCostUSD: saved.costUSD, pricingVersion: saved.version,
        priceCapturedAt: saved.capturedAt, unpriced: saved.costUSD === null, costComplete: saved.costComplete,
        ...(saved.pricingContext ? { pricingContext:saved.pricingContext } : {}),
        ...(row.canonicalModel === 'codex-auto-review' && saved.costBasis !== 'reported' ? {
          pricingContext: saved.pricingContext || { ...row.pricingContext,
            assumedRateModel: history.snapshots[saved.version]?.rates[row.canonicalModel]?.assumedRateModel
              || (saved.costBasis === 'user-assumed-sol-rate' ? 'gpt-6.1-sol' : null),
            rateBasis: saved.costUSD === null ? 'unconfigured' : 'user-selected-assumption' }
        } : {}) };
      return { ...row, recordedCostUSD: saved.costUSD, priceCapturedAt: saved.capturedAt };
    });
  }
  return { apply, calculate, persist,
    metadata: () => ({ currentVersion: id, error, readable,
      recordedBasis: '日志金额或首次索引时捕获的费率；不追溯推测请求发生时的官方历史价。',
      versions: Object.values(history.snapshots).map(({ rates: _, ...metadata }) => metadata) }) };
}

let instance;
function getPricingHistory() { return instance ||= createPricingHistory(); }
function reloadPricingHistory() { instance = createPricingHistory(); return instance; }
module.exports = { createPricingHistory, getPricingHistory, reloadPricingHistory, releasePricingLockForThread };
