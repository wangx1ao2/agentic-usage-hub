'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { hash, snapshotPath, readSnapshot, writeSnapshot } = require('./persistent-cache');

function createIndexClient(options = {}) {
  let worker = null, nextId = 0, revision = 0;
  const pending = new Map(), inflight = new Map(), snapshots = new Map(), failures = new Map();
  const loaded = new Set();
  const clock = options.now || Date.now;
  function start() {
    if (worker) return;
    worker = new Worker(options.workerFile || path.join(__dirname, 'index-worker.js'));
    worker.on('message', message => {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(Object.assign(new Error(typeof message.error === 'string' ? message.error : message.error.message),
        typeof message.error === 'object' ? { statusCode: message.error.statusCode, code: message.error.code } : {}));
      else item.resolve(message.result);
      if (!pending.size) worker?.unref();
    });
    const current = worker;
    const currentThreadId = worker.threadId;
    function fail(error) {
      if (worker !== current) return;
      worker = null;
      for (const item of pending.values()) item.reject(error);
      pending.clear();
    }
    worker.on('error', fail);
    worker.on('exit', code => {
      require('./pricing-history').releasePricingLockForThread(currentThreadId);
      fail(new Error(`Usage index worker exited (${code})`));
    });
    worker.unref();
  }
  function call(operation, args = {}) {
    const key = JSON.stringify([operation, args]);
    if (inflight.has(key)) return inflight.get(key);
    start();
    worker.ref();
    const id = ++nextId;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, operation, args });
    }).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }
  async function query(operation, args = {}, { maxWaitMs = 15_000, ttlMs = 60_000 } = {}) {
    const key = JSON.stringify([operation, args]);
    const identity = options.snapshotIdentity && operation === 'dashboard' ? hash([options.snapshotIdentity, key]) : null;
    const filename = identity ? snapshotPath('dashboards', identity) : null;
    if (filename && !loaded.has(key)) {
      loaded.add(key);
      const restored = readSnapshot(filename, identity);
      if (restored?.meta && restored.totals && restored.meta.sourceSelectionMode !== 'pending') {
        snapshots.set(key, { at: -Infinity, value: { ...restored, meta: { ...restored.meta, stale: true, fromDiskCache: true } } });
      }
    }
    const saved = snapshots.get(key);
    // A loading response is only a placeholder. Recheck it promptly instead
    // of hiding a completed background index behind the normal minute TTL.
    const loading = saved?.value.meta?.refreshing || saved?.value.meta?.sourceSelectionMode === 'pending';
    const effectiveTtl = loading ? Math.min(ttlMs, 1000) : ttlMs;
    if (saved && clock() - saved.at < effectiveTtl) return saved.value;
    const failed = failures.get(key);
    if (saved && failed && clock() - failed.at < 1000) return saved.value.meta
      ? { ...saved.value, meta: { ...saved.value.meta, stale: true, refreshing: false, refreshError: failed.message } } : saved.value;
    const requestedRevision = revision;
    const work = call(operation, args).then(value => {
      if (requestedRevision === revision) {
        failures.delete(key);
        snapshots.delete(key);
        snapshots.set(key, { value, at: clock() });
        if (filename && value.meta?.lastSuccessfulAt && value.meta.sourceSelectionMode !== 'pending') {
          writeSnapshot(filename, identity, value);
        }
        if (snapshots.size > 64) snapshots.delete(snapshots.keys().next().value);
      }
      return value;
    }).catch(error => {
      if (requestedRevision === revision) failures.set(key, { at: clock(), message: error.message });
      if (failures.size > 64) failures.delete(failures.keys().next().value);
      throw error;
    });
    if (saved) {
      work.catch(() => {});
      return saved.value.meta ? { ...saved.value, meta: { ...saved.value.meta, stale: true, refreshing: true } } : saved.value;
    }
    let timer;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimeout(() => { const error = new Error('Usage index is still loading; retry shortly'); error.statusCode = 503; reject(error); }, maxWaitMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  return { query, call, invalidate: () => { revision++; snapshots.clear(); failures.clear(); },
    async dispose() {
      const current = worker;
      if (current) {
        let timer;
        try {
          await Promise.race([call('shutdown'), new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
        } catch (_) { /* An already-terminal worker needs no shutdown response. */ }
        finally { clearTimeout(timer); }
      }
      worker = null;
      snapshots.clear();
      failures.clear(); revision++;
      for (const item of pending.values()) item.reject(new Error('Usage index disposed'));
      pending.clear();
      if (current) await current.terminate();
    } };
}

module.exports = { createIndexClient };
