'use strict';

require('./config');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { cacheDir, codexHome } = require('./config');
const { hash } = require('./persistent-cache');
const { configuredProjects } = require('./business-api-usage');

// Account reads are optional network activity, independent of local API logs.
const accountQuotaEnabled = () => process.env.CODEX_ACCOUNT_QUOTA_ENABLED === '1'
  && process.env.CODEX_ACCOUNT_QUOTA_DISABLED !== '1';

function resolveCodexCommand() {
  if (process.env.CODEX_QUOTA_BIN) return [process.env.CODEX_QUOTA_BIN];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const triple = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
  const roots = configuredProjects().map(root => path.join(root, '.runtime', 'codex-cli', 'node_modules'));
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    if (fs.existsSync(path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex'))) {
      return [path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')];
    }
    roots.push(path.join(directory, 'node_modules'));
  }
  for (const root of roots) {
    if (process.platform === 'win32') {
      for (const vendor of [path.join(root, '@openai', `codex-win32-${arch}`, 'vendor'),
        path.join(root, '@openai', 'codex', 'vendor'),
        path.join(root, '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor')]) {
        const binary = path.join(vendor, triple, 'bin', 'codex.exe');
        if (fs.existsSync(binary)) return [binary];
      }
    }
    const entry = path.join(root, '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(entry)) return [process.execPath, entry];
  }
  throw new Error('Codex CLI not found; set CODEX_QUOTA_BIN to its executable path');
}

// Only the public account read is sent. No thread or model turn is created,
// and neither credentials nor stderr are retained in the usage ledger.
function readAccountRateLimits({ command = resolveCodexCommand(), timeoutMs = 12_000, spawnProcess = spawn, signal } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CODEX_HOME: codexHome };
    for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL', 'OPENAI_API_BASE']) delete env[key];
    let child, timer, pending = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child?.stdin.destroy();
      child?.kill();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error('Codex quota reader stopped'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      child = spawnProcess(command[0], [...command.slice(1), 'app-server', '-c', 'model_provider="openai"'],
        { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const send = value => child.stdin.write(JSON.stringify(value) + '\n');
      child.on('error', () => finish(new Error('Cannot start Codex quota reader')));
      child.on('close', () => finish(new Error('Codex quota reader exited before returning rate limits')));
      child.stdin.on('error', () => finish(new Error('Codex quota reader connection failed')));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        pending += chunk;
        if (pending.length > 256 * 1024) return finish(new Error('Codex quota response exceeded size limit'));
        let end;
        while (!settled && (end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          let message;
          try { message = JSON.parse(line); } catch (_) { continue; }
          if (message.id === 1) {
            if (message.error) return finish(new Error('Codex quota reader initialization failed'));
            send({ method: 'initialized', params: {} });
            send({ id: 2, method: 'account/rateLimits/read' });
          } else if (message.id === 2) {
            return message.error ? finish(new Error('Cannot read ChatGPT account rate limits')) : finish(null, message.result);
          }
        }
      });
      timer = setTimeout(() => finish(new Error('Codex account rate-limit read timed out')), timeoutMs);
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'agentic_usage_hub', version: require('../package.json').version } } });
    } catch (_) { finish(new Error('Cannot start Codex quota reader')); }
  });
}

function normalizeAccountQuota(result, timestamp = Date.now()) {
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!limits || (limits.limitId && limits.limitId !== 'codex')) return null;
  const window = [limits.primary, limits.secondary].find(row => row?.windowDurationMins === 300);
  if (!window || !Number.isFinite(window.usedPercent) || window.usedPercent < 0
    || !Number.isSafeInteger(window.resetsAt) || window.resetsAt <= 0) return null;
  return { timestamp, observedAt: new Date(timestamp).toISOString(), usedPercent: window.usedPercent,
    resetsAt: window.resetsAt * 1000, windowMinutes: 300, planType: limits.planType || null, source: 'account-rate-limits' };
}

function validSnapshot(row) {
  return row && Number.isFinite(row.timestamp) && Number.isFinite(row.resetsAt)
    && Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.windowMinutes === 300;
}

function createAccountQuotaMonitor({ filename = path.join(cacheDir, 'codex-quota', `${hash([codexHome, 1])}.jsonl`),
  read = readAccountRateLimits, now = Date.now, enabled = accountQuotaEnabled } = {}) {
  let inflight, controller, lastAttempt = 0, lastSuccessfulAt = null, error = null;
  let snapshots = [], fingerprint = null, ledgerError = null;
  function getSnapshots() {
    try {
      const stat = fs.statSync(filename);
      const next = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
      if (next === fingerprint) return snapshots;
      const content = fs.readFileSync(filename, 'utf8');
      if (!content.endsWith('\n')) throw new Error('Codex quota ledger has an incomplete tail');
      const rows = content.split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (!rows.every(validSnapshot)) throw new Error('Invalid Codex quota ledger row');
      snapshots = rows;
      fingerprint = next;
      ledgerError = null;
    } catch (failure) {
      if (failure.code === 'ENOENT') { snapshots = []; fingerprint = null; ledgerError = null; }
      else ledgerError = 'Cannot read Codex quota ledger; last valid observations are retained';
    }
    return snapshots;
  }
  function append(snapshot) {
    getSnapshots();
    if (ledgerError) throw new Error(ledgerError);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.appendFileSync(filename, JSON.stringify(snapshot) + '\n', 'utf8');
    fingerprint = null;
    getSnapshots();
  }
  return {
    getSnapshots,
    capture(force = false) {
      if (!enabled()) return Promise.resolve(null);
      if (inflight) return inflight;
      if (!force && lastAttempt && now() - lastAttempt < 30_000) return Promise.resolve(null);
      lastAttempt = now();
      controller = new AbortController();
      inflight = Promise.resolve().then(() => read({ signal: controller.signal })).then(result => {
        const snapshot = normalizeAccountQuota(result, now());
        // Weekly-only plans legitimately have no five-hour bucket.
        if (snapshot) append(snapshot);
        error = null; lastSuccessfulAt = new Date(now()).toISOString();
        return snapshot;
      }).catch(() => { error = 'Codex account quota could not be refreshed; saved observations are retained'; return null; })
        .finally(() => { inflight = null; controller = null; });
      return inflight;
    },
    confirmWindow({ resetsAt, usedPercent, note }) {
      if (!Number.isSafeInteger(resetsAt) || !Number.isFinite(usedPercent) || usedPercent < 0 || typeof note !== 'string' || !note.trim()) {
        throw new Error('A window reset, percentage and confirmation note are required');
      }
      if (getSnapshots().some(row => row.source === 'user-confirmed' && row.resetsAt === resetsAt && row.usedPercent === usedPercent)) return;
      // This is an effective end-of-window correction, not a fabricated live
      // observation or a claim about the first time the quota was exhausted.
      append({ timestamp: resetsAt - 1, observedAt: null, confirmedAt: new Date(now()).toISOString(),
        resetsAt, usedPercent, windowMinutes: 300, source: 'user-confirmed', note });
    },
    getDiagnostics() {
      getSnapshots();
      return { source: 'codexAccount', status: error || ledgerError ? 'partial' : !enabled() ? 'disabled' : snapshots.length ? 'ready' : 'empty',
        available: snapshots.length > 0, stale: !!(error || ledgerError), refreshing: !!inflight,
        enabled: enabled(), networkAccess: enabled() ? 'enabled' : 'disabled',
        pathNotice: enabled() ? '已显式启用联网账号额度查询；本地日志统计独立运行。'
          : '联网查询未启用；保留已保存历史。设置 CODEX_ACCOUNT_QUOTA_ENABLED=1 后启用，与业务项目配置无关。',
        lastSuccessfulAt, error: ledgerError || error, readErrors: Number(!!(error || ledgerError)), observations: snapshots.length };
    },
    async dispose() { controller?.abort(); await inflight; }
  };
}

const monitor = createAccountQuotaMonitor();
module.exports = { readAccountRateLimits, normalizeAccountQuota, createAccountQuotaMonitor, resolveCodexCommand, accountQuotaEnabled, monitor };
