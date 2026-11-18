'use strict';

/**
 * Agentic Usage Hub — Codex (ccusage) 数据加载器
 *
 * 修复 C1：原实现在 HTTP 请求处理链上用 spawnSync(timeout=90s) 同步拉起 ccusage
 * 子进程，最长让 Node 主循环停摆 90 秒——期间所有其它请求（静态资源、/api/projects
 * 等）完全无法响应；退避 cooldown 只能挡重复 spawn，挡不住第一次硬阻塞。
 *
 * 新模型（异步 + 后台预热 + stale-while-revalidate）：
 *   - 真正的子进程调用改用异步 spawn，绝不阻塞事件循环；
 *   - 进程启动即预热（startWarmup），并按 TTL 定时后台刷新；
 *   - getCodexDataSync() 只读当前内存缓存，永不 spawn/阻塞；数据过期时仅「触发」一次
 *     后台刷新并立即返回旧值（SWR）；
 *   - ensureFresh() 供 HTTP 首帧等待（非阻塞式 await），冷启动也能拿到完整数据；
 *   - 结果异步落盘到 .cache/ccusage-cache.json，重启后同步读回，首帧即有历史数据。
 *
 * 完全离线：--offline 强制使用本地内置价格表，避免受限网络下 ccusage 拉取远端价格
 * 表卡死 50s+ 触发超时雪崩（详见项目记忆）。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { threadId } = require('node:worker_threads');
const { enrichCodexUsage, applyRequestPricing, CODEX_MODEL_NAMES_VERSION } = require('./codex-request-usage');
const { QUOTA_TIMELINE_VERSION } = require('./codex-quota-history');
const { prepareCodexInput, CODEX_INPUT_VERSION } = require('./codex-input');
const { hash, getRuntimeIdentity } = require('./persistent-cache');

// 与旧实现一致的路径，保证缓存文件迁移无缝
const CACHE_DIR = require('./config').cacheDir;
const CCUSAGE_CACHE_FILE = path.join(CACHE_DIR, 'ccusage-cache.json');
// npm may hoist ccusage beside this package instead of inside it. Resolve from
// the module graph so npx/global/tarball installs use the same upstream binary.
const CCUSAGE_PACKAGE_PATH = require.resolve('ccusage/package.json');
const CCUSAGE_PACKAGE = require(CCUSAGE_PACKAGE_PATH);
const CLI_PATH = path.resolve(path.dirname(CCUSAGE_PACKAGE_PATH), CCUSAGE_PACKAGE.bin.ccusage);

// N5: 环境浅拷贝提到模块顶层，避免每次 spawn 复制 process.env
const BASE_ENV = { ...process.env, NO_COLOR: '1' };
// Keep provenance before aggregation. The plain `daily` report includes agents
// also parsed by our own adapters (Qwen, OpenClaw, Gemini, etc.).
const ARGS_MAIN = ['daily', '--json', '--offline', '--by-agent'];
const ARGS_FB = ['codex', 'daily', '--json', '--offline'];
const SELECTED_AGENTS = new Set(['codex', 'claude', 'grok']);
const SOURCE_SELECTION_VERSION = 2;

const SPAWN_TIMEOUT_MS = Number(process.env.CCUSAGE_SPAWN_TIMEOUT) || 90_000;
const CACHE_TTL = 3 * 60_000;        // 内存数据新鲜期 3 分钟
const REFRESH_INTERVAL = 60_000;     // 后台预热刷新周期
const FAIL_COOLDOWN = 60_000;        // 失败退避

const EMPTY = Object.freeze({ daily: [], totals: {} });

const state = {
  data: null,        // 最近一次成功解析的 ccusage JSON
  ts: 0,             // 最近一次成功时间戳
  inflight: null,    // 进行中的 refresh Promise（单飞）
  failUntil: 0,      // 失败退避截止
  error: null, parseErrors: 0, pendingLines: 0, index: null
};
let stopped = false;
const children = new Set();
let persistQueue = Promise.resolve(), persistRevision = 0;

function dbg(...args) {
  if (process.env.DEBUG_CC) console.error('[codex-loader]', ...args);
}

function loadPersisted() {
  // Older releases wrote into the project. Keep that snapshot available
  // during the first rebuild after switching to the per-user cache directory.
  const candidates = [CCUSAGE_CACHE_FILE];
  if (!process.env.AGENTIC_CACHE_DIR) candidates.push(path.join(__dirname, '..', '.cache', 'ccusage-cache.json'));
  for (const filename of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (parsed && parsed._sourceSelectionVersion === SOURCE_SELECTION_VERSION && Array.isArray(parsed.daily)) {
        const oldModelNames = parsed._codexModelNamesVersion !== CODEX_MODEL_NAMES_VERSION
          || parsed._reviewPricingIdentity !== hash(require('../models-pricing').MODEL_CATALOG['codex-auto-review']);
        if (oldModelNames && Array.isArray(parsed.requestRecords) && Array.isArray(parsed.quotaSnapshots)) {
          applyRequestPricing(parsed, [{ events: parsed.requestRecords, snapshots: parsed.quotaSnapshots }]);
        }
        state.data = parsed;
        // 用文件 mtime 作为数据时间戳，让过期判断基于真实新鲜度而非读取时刻
        state.ts = Number(parsed._sourceReadAt) || 0;
        if (oldModelNames) state.ts = 0;
        // Rebuild old quota grouping even when the persisted cache is fresh.
        if (parsed.codexQuota?.timelineVersion !== QUOTA_TIMELINE_VERSION) state.ts = 0;
        if (parsed._codexInputVersion !== CODEX_INPUT_VERSION) state.ts = 0;
        if (!Array.isArray(parsed.quotaSnapshots)) state.ts = 0;
        dbg('已加载持久化缓存', state.ts);
        return;
      }
    } catch (e) {
      dbg('读取持久化缓存失败:', e.message);
    }
  }
}

function persistAsync(data) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (e) { /* 目录已存在或无权限，交给 writeFile 的回调处理 */ }
  const temporary = `${CCUSAGE_CACHE_FILE}.${process.pid}.${threadId}.${++persistRevision}.tmp`;
  const serialized = JSON.stringify(data);
  persistQueue = persistQueue.then(async () => {
    try { await fs.promises.writeFile(temporary, serialized); await fs.promises.rename(temporary, CCUSAGE_CACHE_FILE); }
    catch (err) { dbg('写缓存失败:', err.message); await fs.promises.unlink(temporary).catch(() => {}); }
  });
}

/** 异步拉起一次 ccusage，返回 { ok, data | err }，绝不阻塞事件循环 */
function runOnce(args, timeoutMs, codexHome) {
  return new Promise(resolve => {
    if (stopped) return resolve({ ok: false, err: new Error('Usage loader stopped') });
    let child;
    try {
      child = spawn(process.execPath, ['--require', path.join(__dirname, 'child-lifecycle.cjs'), CLI_PATH, ...args], {
        env: codexHome ? { ...BASE_ENV, CODEX_HOME: codexHome } : BASE_ENV,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });
    } catch (e) {
      return resolve({ ok: false, err: e });
    }
    children.add(child);

    let stdout = '';
    let stderr = '';
    let killed = false;
    let settled = false;

    const finish = (r) => {
      if (settled) return;
      settled = true;
      children.delete(child);
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGKILL'); } catch (e) {}
      finish({ ok: false, err: new Error(`ccusage timeout after ${timeoutMs}ms`) });
    }, timeoutMs);

    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { if (stderr.length < 4000) stderr += c; });

    child.on('error', err => finish({ ok: false, err }));
    child.on('close', code => {
      if (killed) return finish({ ok: false, err: new Error('timeout') });
      if (code !== 0 || !stdout.trim()) {
        return finish({ ok: false, err: new Error(`exit ${code}: ${stderr.slice(0, 200)}`) });
      }
      try {
        finish({ ok: true, data: JSON.parse(stdout.trim()) });
      } catch (e) {
        // N4: parse 失败时打印前 200 字节，便于定位 stdout 污染
        finish({ ok: false, err: new Error(`JSON parse failed: ${e.message} | head=${stdout.slice(0, 200)}`) });
      }
    });
  });
}

function selectUsageSources(raw, codexOnly = false) {
  if (!raw || !Array.isArray(raw.daily)) return null;
  const byDate = new Map();
  for (const row of raw.daily) {
    const date = row.period || row.date;
    if (!date) continue;
    // The unified report must provide source rows. Otherwise it cannot be
    // safely combined with the adapters that read the same local files.
    if (!codexOnly && !Array.isArray(row.agents)) return null;
    const sourceRows = codexOnly ? [{ ...row, agent: 'codex' }] : row.agents;
    for (const source of sourceRows) {
      const agent = String(source.agent || '').toLowerCase();
      if (!SELECTED_AGENTS.has(agent) || (codexOnly && agent !== 'codex')) continue;
      let day = byDate.get(date);
      if (!day) {
        day = {
          period: date, date, agent: 'selected', modelBreakdowns: [], modelsUsed: [],
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
          totalTokens: 0, totalCost: 0
        };
        byDate.set(date, day);
      }
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'totalTokens', 'totalCost']) {
        day[field] += Number(field === 'totalCost' ? (source.totalCost ?? source.costUSD ?? source.cost) : source[field]) || 0;
      }
      for (const model of (source.modelBreakdowns || [])) {
        day.modelBreakdowns.push({ ...model, agent });
      }
      day.modelsUsed.push(...(source.modelsUsed || []));
      if (codexOnly && source.models) {
        day.models = source.models;
        day.modelsUsed.push(...Object.keys(source.models));
      }
    }
  }
  return {
    daily: Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
    totals: {},
    _sourceSelectionVersion: SOURCE_SELECTION_VERSION,
    _sourceSelectionMode: codexOnly ? 'codex-only-fallback' : 'selected-agents'
  };
}

let warmupTimer = null;

function additionalInputsSignature() {
  const home = require('node:os').homedir();
  const roots = [...new Set([path.join(home, '.claude'), path.join(home, '.grok'),
    process.env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_SESSIONS_DIR, process.env.GROK_HOME,
    process.env.GROK_CONFIG_DIR, path.join(home, '.config', 'ccusage')].filter(Boolean))];
  const found = require('./source-index').discover(roots,
    filename => /\.(?:jsonl|json|toml)$/i.test(filename));
  if (found.readErrors) throw new Error('Some additional ccusage inputs could not be checked; retaining the last snapshot');
  return found.files.sort().map(filename => {
    const stat = fs.statSync(filename);
    return [filename, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino];
  });
}

/** 单飞刷新：主命令失败自动回落 codex 子命令；成功更新内存 + 异步落盘 */
function refresh() {
  if (stopped) return Promise.resolve(false);
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      // Both the main totals and quota history must see exactly the same
      // complete input, including .jsonl.zst archives omitted by ccusage.
      const input = await prepareCodexInput();
      if (stopped) return false;
      state.parseErrors = input.parseErrors || 0;
      state.pendingLines = input.pendingLines || 0;
      if (state.parseErrors) throw new Error(`${state.parseErrors} malformed completed Codex usage rows; retaining the last successful snapshot`);
      const signature = hash([getRuntimeIdentity(), input.signature, additionalInputsSignature(),
        CCUSAGE_PACKAGE.version]);
      state.index = { changedFiles: input.changedFiles, reusedFiles: input.reusedFiles, nativeReportReused: false };
      if (state.data?._inputsSignature === signature && state.data._sourceSelectionMode === 'selected-agents'
        && !state.data.requestReadErrors) {
        state.ts = Date.now(); state.failUntil = 0; state.error = null;
        state.index.nativeReportReused = true;
        return true;
      }
      const t0 = Date.now();
      let r = await runOnce(ARGS_MAIN, SPAWN_TIMEOUT_MS, input.home);
      dbg(`attempt1 ${Date.now() - t0}ms ok=${r.ok}`);
      if (r.ok) {
        const selected = selectUsageSources(r.data);
        r = selected ? { ok: true, data: selected } : { ok: false, err: new Error('ccusage source breakdown missing') };
      }
      if (!r.ok) {
        const t1 = Date.now();
        r = await runOnce(ARGS_FB, SPAWN_TIMEOUT_MS, input.home);
        dbg(`attempt2 ${Date.now() - t1}ms ok=${r.ok}`);
        if (r.ok) {
          const selected = selectUsageSources(r.data, true);
          r = selected ? { ok: true, data: selected } : { ok: false, err: new Error('ccusage Codex report invalid') };
        }
      }
      if (r.ok) {
        await enrichCodexUsage(r.data, { roots: input.roots });
        if (stopped) return false;
        r.data._codexInputVersion = input.version;
        r.data._inputsSignature = signature;
        state.ts = Date.now();
        r.data._sourceReadAt = state.ts;
        state.data = r.data;
        state.failUntil = 0;
        state.error = null;
        persistAsync(r.data);
      } else {
        state.failUntil = Date.now() + FAIL_COOLDOWN;
        state.error = r.err?.message || 'ccusage refresh failed';
        dbg('刷新失败:', r.err && r.err.message);
      }
      return r.ok;
    } catch (error) {
      // A failed archive read must never replace complete historical totals
      // with a successful but incomplete report containing only recent logs.
      state.failUntil = Date.now() + FAIL_COOLDOWN;
      state.error = error.message;
      dbg('完整历史刷新失败，保留缓存:', error.message);
      return false;
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

function isFresh() {
  return !!state.data && (Date.now() - state.ts) < CACHE_TTL;
}

/**
 * 同步读取器 —— 供同步的 buildDashboardData / MCP 调用。永不 spawn、永不阻塞。
 * 数据过期时仅「后台触发」一次刷新并返回旧值（stale-while-revalidate）。
 */
function getCodexDataSync(force = false) {
  const now = Date.now();
  if (!force && isFresh()) return state.data;
  if (!force && now < state.failUntil) return state.data || EMPTY;
  if (!state.inflight) {
    // fire-and-forget：不 await，保证请求路径零阻塞
    refresh().catch(() => {});
  }
  // 若已有旧数据 → 立即返回旧值(SWR)；若冷启动无数据 → 返回空占位，由预热/ensureFresh补齐
  return state.data || EMPTY;
}

/**
 * 首帧兜底：若无新鲜数据，异步等待一次刷新完成（带超时上限）。
 * 只 await 子进程 I/O，不阻塞事件循环——期间其它请求可正常被服务。
 * 有新鲜数据则立即 resolve，代价为一次布尔判断。
 */
async function ensureFresh(maxWaitMs = 15_000) {
  if (isFresh()) return state.data;
  if (Date.now() < state.failUntil) return state.data || EMPTY;
  const p = refresh();
  // 有界等待：超时则返回现有(可能为空)数据，后台刷新继续跑完并落盘
  let timer;
  const timeout = new Promise(res => { timer = setTimeout(() => res('timeout'), maxWaitMs); });
  await Promise.race([p, timeout]);
  clearTimeout(timer);
  // p 若仍在跑，等它自己完成；此处只保证不无限等待
  return state.data || EMPTY;
}

/** 强制刷新（供 /api/refresh 使用）：清退避 + 拉起一次刷新 */
function forceRefresh() {
  state.failUntil = 0;
  return refresh();
}

/** 启动后台预热与定时刷新（.unref() 保证不阻止进程退出） */
function startWarmup() {
  refresh().catch(() => {});
  if (!warmupTimer) {
    warmupTimer = setInterval(() => {
      if (!state.inflight && Date.now() >= state.failUntil && (Date.now() - state.ts) > REFRESH_INTERVAL) {
        refresh().catch(() => {});
      }
    }, REFRESH_INTERVAL);
    if (typeof warmupTimer.unref === 'function') warmupTimer.unref();
  }
}

/** 供优雅退出时刷新落盘（异步写已在 persistAsync 内 fire-and-forget，这里触发一次即时写） */
function flushCacheSync() {
  if (!state.data) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const temporary = `${CCUSAGE_CACHE_FILE}.${process.pid}.${threadId}.flush.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state.data));
    fs.renameSync(temporary, CCUSAGE_CACHE_FILE);
  } catch (e) {
    dbg('flushCacheSync 失败:', e.message);
  }
}

// 模块加载即读回持久缓存，重启后首帧即有历史数据
loadPersisted();

module.exports = {
  stop: () => { stopped = true; clearInterval(warmupTimer); warmupTimer = null;
    for (const child of children) { try { child.kill('SIGKILL'); } catch (_) {} } },
  stopAndFlush: async () => { module.exports.stop(); await persistQueue; },
  getStatus: () => ({ lastSuccessfulAt: state.ts ? new Date(state.ts).toISOString() : null,
    stale: !isFresh() || !!state.error || !!state.data?.requestReadErrors, refreshing: !!state.inflight,
    error: state.error || (state.data?.requestReadErrors ? 'Some Codex request details could not be read' : null),
    readErrors: state.data?.requestReadErrors || 0, parseErrors: state.parseErrors, pendingLines: state.pendingLines,
    available: !!state.data, sourceSelectionMode: state.data?._sourceSelectionMode || 'pending', index: state.index }),
  getCodexDataSync,
  ensureFresh,
  forceRefresh,
  startWarmup,
  flushCacheSync,
  isFresh,
  EMPTY,
  selectUsageSources
};
