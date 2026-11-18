'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { MODEL_CATALOG } = require('../models-pricing');
const { cacheDir } = require('./config');
const { threadId } = require('node:worker_threads');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

function validateHistory(saved) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(saved) || saved.schemaVersion !== 1 || !object(saved.snapshots) || !object(saved.records)
    || Object.entries(saved.snapshots).some(([key, row]) => !/^catalog-[a-f0-9]{24}$/.test(key)
      || !object(row) || !object(row.rates) || row.id !== key || key !== 'catalog-' + hash(row.rates)
      || Object.values(row.rates).some(rates => !object(rates) || ['standard', 'flagship'].some(tier => !object(rates[tier])
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
  const rates = Object.fromEntries(Object.entries(catalog).map(([model, row]) => [model, { standard: row.standard, flagship: row.flagship || row.standard,
    ...(row.unpriced ? { unpriced: true } : {}), ...(row.assumedRateModel ? { assumedRateModel: row.assumedRateModel } : {}) }]));
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
  function calculate(record, snapshot, tier) {
    const row = Object.hasOwn(snapshot.rates, record.canonicalModel) ? snapshot.rates[record.canonicalModel]
      : record.canonicalModel === 'codex-auto-review' && (record.pricingContext?.assumedRateModel || record.costBasis === 'user-assumed-sol-rate')
        ? snapshot.rates[record.pricingContext?.assumedRateModel || 'gpt-6.1-sol'] : null;
    if (!row || row.unpriced) return null;
    const price = record.source === 'zcode' && tier === 'flagship' ? row.flagship : row.standard;
    if (!price) return null;
    const context = record.pricingContext;
    const rateModel = row.assumedRateModel || (record.canonicalModel === 'codex-auto-review'
      ? context?.assumedRateModel || 'gpt-6.1-sol' : record.canonicalModel);
    const longContext = ['codex', 'api'].includes(record.source) && (/^gpt-6(?:\.1)?-(?:astra|sol|luna)$/.test(rateModel) || rateModel === 'gpt-6.1-terra')
      && record.granularity === 'request' && record.inputTokens + record.cacheReadTokens > 272_000;
    const speed = ['fast', 'priority'].includes(context?.serviceTier) ? 2 : context?.serviceTier === 'ultrafast' ? 6 : 1;
    return +(((record.inputTokens * price.in + record.cacheReadTokens * price.cache) * (longContext ? 2 : 1)
      + record.outputTokens * price.out * (longContext ? 1.5 : 1)) / 1e6 * speed).toFixed(6);
  }
  function apply(records, { pricingMode = 'recorded', pricingVersion, tier = 'standard' } = {}) {
    if (pricingMode === 'recorded' && pricingVersion) throw Object.assign(new Error('A catalog version requires current/recalculation mode'), { statusCode: 400 });
    const selected = history.snapshots[pricingVersion || id];
    if (!selected || !Object.hasOwn(history.snapshots, pricingVersion || id)) throw Object.assign(new Error('Unknown pricing version'), { statusCode: 400 });
    const captures = [];
    const output = records.map(record => {
      const key = hash([record.id, tier, record.inputTokens, record.cacheReadTokens, record.cacheWriteTokens,
        record.outputTokens, record.totalTokens, record.costBasis, record.costBasis === 'reported' ? record.costUSD : null]);
      let saved = history.records[key];
      captures.push(key);
      if (!saved) {
        saved = { costUSD: record.costUSD, unpriced: record.unpriced, costComplete: record.costUSD !== null && record.costComplete !== false,
          version: record.costBasis === 'reported' ? 'reported' : id, capturedAt: now(), costBasis: record.costBasis };
        history.records[key] = saved; dirty = true;
      }
      const recorded = pricingMode === 'recorded' && readable;
      const costUSD = recorded ? saved.costUSD : calculate(record, selected, tier);
      return { ...record, costUSD, recordedCostUSD: saved.costUSD,
        unpriced: costUSD === null,
        costComplete: recorded ? saved.costComplete : costUSD !== null && !record.cacheWriteTokens,
        costBasis: recorded ? saved.costBasis : costUSD === null ? 'unpriced' : 'catalog-recalculation',
        costEstimated: recorded ? record.costEstimated : true,
        pricingVersion: recorded ? saved.version : selected.id,
        priceCapturedAt: saved.capturedAt, pricingHistoryUnavailable: !!error };
    });
    persist();
    return output.map((row, index) => {
      const saved = history.records[captures[index]];
      if (!readable) {
        const cost = calculate(records[index], selected, tier);
        return { ...row, costUSD: cost, recordedCostUSD: saved.costUSD, unpriced: cost === null,
          costBasis: cost === null ? 'unpriced' : 'catalog-recalculation', pricingVersion: selected.id,
          pricingHistoryUnavailable: true, costComplete: cost !== null && !row.cacheWriteTokens };
      }
      if (pricingMode === 'recorded') return { ...row, costUSD: saved.costUSD, recordedCostUSD: saved.costUSD, pricingVersion: saved.version,
        priceCapturedAt: saved.capturedAt, unpriced: saved.costUSD === null, costComplete: saved.costComplete };
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
