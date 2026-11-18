const { spawn } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { calculateModelCost } = require('./models-pricing');

const BASE_ENV = { ...process.env, NO_COLOR: '1' };

let cache = null;
let lastFetch = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache
let inflightStatus = null; // C1: 单飞后台刷新的 Promise，避免并发堆叠多个子进程

let dailyCache = null;
let dailyCacheTime = 0;

// 把原始 antigravity-usage JSON 规整成看板所需结构（保持与旧实现完全一致的字段）
function transformStatus(raw) {
  const monthlyCredits = raw.promptCredits?.monthly || 0;
  const availableCredits = raw.promptCredits?.available || 0;
  const usedPercentage = raw.promptCredits?.usedPercentage ?? 0;
  const usedCredits = monthlyCredits * usedPercentage;

  const unifiedTokensPool = monthlyCredits * 1000;
  const unifiedTokensUsed = Math.round(usedCredits * 1000);
  const unifiedTokensRemaining = Math.round(availableCredits * 1000);

  // Credits have no reliable fixed USD exchange rate. Keep monetary usage in
  // the daily log-derived estimate instead of inventing a subscription bill.
  const unifiedCostPool = 0;
  const unifiedCostUsed = 0;
  const unifiedCostRemaining = 0;

  const models = (raw.models || []).map(m => ({
    label: m.label,
    modelId: m.modelId,
    remainingPercentage: +(m.remainingPercentage * 100).toFixed(1),
    remainingTokensEquivalent: Math.round(m.remainingPercentage * 10_000_000),
    resetTime: m.resetTime,
    timeUntilResetMs: m.timeUntilResetMs,
    isExhausted: m.isExhausted
  }));

  return {
    agent: 'antigravity',
    connected: true,
    email: raw.email || 'local-user',
    timestamp: raw.timestamp || new Date().toISOString(),
    tokens: {
      totalPool: unifiedTokensPool,
      used: unifiedTokensUsed,
      remaining: unifiedTokensRemaining,
      formattedTotal: (unifiedTokensPool / 1e6).toFixed(1) + 'M',
      formattedUsed: (unifiedTokensUsed / 1e6).toFixed(1) + 'M',
      formattedRemaining: (unifiedTokensRemaining / 1e6).toFixed(1) + 'M'
    },
    costUSD: {
      totalPool: unifiedCostPool,
      used: unifiedCostUsed,
      remaining: unifiedCostRemaining,
      formattedUsed: '$' + unifiedCostUsed.toFixed(2),
      formattedRemaining: '$' + unifiedCostRemaining.toFixed(2)
    },
    credits: raw.promptCredits,
    models: models
  };
}

const DISCONNECTED = () => ({
  agent: 'antigravity',
  connected: false,
  tokens: { totalPool: 0, used: 0, remaining: 0, formattedTotal: '0.0M', formattedUsed: '0.0M', formattedRemaining: '0.0M' },
  costUSD: { totalPool: 0, used: 0, remaining: 0, formattedUsed: '$0.00', formattedRemaining: '$0.00' },
  models: []
});

// C1: 后台异步刷新，绝不在同步路径 spawnSync。单飞保护。
function fetchStatusAsync() {
  if (inflightStatus) return inflightStatus;
  const localBin = path.join(__dirname, 'node_modules', '.bin', process.platform === 'win32' ? 'antigravity-usage.cmd' : 'antigravity-usage');
  const usageBin = process.env.ANTIGRAVITY_USAGE_BIN || localBin;
  if (!fs.existsSync(usageBin)) return Promise.resolve(false);
  inflightStatus = new Promise(resolve => {
    let child;
    try {
      child = spawn(usageBin, ['--json'], {
        shell: process.platform === 'win32',
        env: BASE_ENV,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      inflightStatus = null;
      return resolve(false);
    }
    let stdout = '', stderr = '', killed = false, settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      inflightStatus = null;
      resolve(ok);
    };
    const timer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch (e) {} done(false); }, 10000);
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { if (stderr.length < 2000) stderr += c; });
    child.on('error', () => done(false));
    child.on('close', code => {
      if (killed || code !== 0 || !stdout.trim()) return done(false);
      try {
        cache = transformStatus(JSON.parse(stdout.trim()));
        lastFetch = Date.now();
        done(true);
      } catch (e) { done(false); }
    });
  });
  return inflightStatus;
}

function getAntigravityStatus(forceRefresh = false) {
  const now = Date.now();
  const stale = forceRefresh || !cache || (now - lastFetch >= CACHE_TTL_MS);
  if (stale) fetchStatusAsync().catch(() => {}); // fire-and-forget，不阻塞
  return cache || DISCONNECTED();
}

function getLocalDateFromISO(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAntigravityDaily(force = false) {
  return require('./lib/request-record').recordsToDaily(require('./lib/log-sources').sources.antigravity.getRecords(force));
}
module.exports = { getAntigravityStatus, getAntigravityDaily,
  getUsageRecords: force => require('./lib/log-sources').sources.antigravity.getRecords(force),
  getDiagnostics: () => require('./lib/log-sources').sources.antigravity.getDiagnostics() };
