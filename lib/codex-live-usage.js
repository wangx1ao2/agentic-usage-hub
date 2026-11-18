'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const { createRecordParser } = require('./codex-request-usage');
const { createLiveImageMonitor } = require('./codex-live-images');

const WINDOW_MS = 60_000;
const RECENT_MS = 300_000;
const DISCOVERY_MS = 15_000;
const IDLE_RELEASE_MS = 60_000;
const MAX_LINE_LENGTH = 1024 * 1024;
const DISCOVERY_TAIL_BYTES = 64 * 1024;

async function hasRecentRecords(filename, stat, now) {
  if (!stat.size) return false;
  const handle = await fs.promises.open(filename, 'r');
  try {
    const start = Math.max(0, stat.size - DISCOVERY_TAIL_BYTES);
    const buffer = Buffer.alloc(Math.min(stat.size, DISCOVERY_TAIL_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    // Ignore the first partial line. Only inspect small timestamp prefixes,
    // never parse or retain prompt/tool bodies during discovery.
    if (start > 0) lines.shift();
    return lines.some(line => {
      const match = line.slice(0, 256).match(/"timestamp"\s*:\s*"([^"]+)"/);
      const time = match ? Date.parse(match[1]) : NaN;
      return time > now - RECENT_MS && time <= now;
    });
  } finally { await handle.close(); }
}

function summarizeUsage(events, now) {
  const unique = new Map();
  for (const event of events) {
    const counts = [event.inputTokens, event.cacheReadTokens, event.outputTokens];
    if (!counts.every(value => Number.isFinite(value) && value >= 0) || !counts.some(value => value > 0)) continue;
    if (event.timestamp > now - RECENT_MS && event.timestamp <= now) unique.set(event.key, event);
  }
  const totals = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
  const sessions = new Map();
  for (const event of unique.values()) {
    let session = sessions.get(event.sessionId);
    if (!session) {
      session = { sessionId: event.sessionId, cwd: event.cwd, model: event.model,
        lastUsageAt: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
      sessions.set(event.sessionId, session);
    }
    if (event.timestamp >= session.lastUsageAt) {
      session.lastUsageAt = event.timestamp;
      session.model = event.model;
      session.cwd = event.cwd;
    }
    if (event.timestamp <= now - WINDOW_MS) continue;
    // Codex input_tokens includes cache reads; output includes reasoning.
    const counts = { inputTokens: event.inputTokens, cacheReadTokens: event.cacheReadTokens,
      outputTokens: event.outputTokens,
      totalTokens: event.inputTokens + event.cacheReadTokens + event.outputTokens, requests: 1 };
    for (const key of Object.keys(totals)) {
      totals[key] += counts[key];
      session[key] += counts[key];
    }
  }
  const withRates = row => ({ ...row,
    inputTokensPerSecond: row.inputTokens / 60,
    cacheReadTokensPerSecond: row.cacheReadTokens / 60,
    outputTokensPerSecond: row.outputTokens / 60,
    tokensPerSecond: row.totalTokens / 60 });
  const rows = [...sessions.values()].map(row => ({ ...withRates(row), active: row.requests > 0 }))
    .sort((a, b) => b.tokensPerSecond - a.tokensPerSecond || b.lastUsageAt - a.lastUsageAt);
  return { agent: 'codex', generatedAt: now, windowSeconds: 60, recentSeconds: 300,
    basis: 'logged-request-usage', activeSessionCount: rows.filter(row => row.active).length,
    totals: withRates(totals), sessions: rows };
}

function createLiveMonitor(options = {}) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const roots = options.roots || [path.join(codexHome, 'sessions')];
  const clock = options.now || Date.now;
  const imageDirs = options.imageDirs ?? (options.roots ? [] : [
    ...(process.env.CODEX_IMAGE_DIRS || '').split(path.delimiter).filter(Boolean),
    ...(process.env.CODEX_IMAGE_DIR ? [process.env.CODEX_IMAGE_DIR] : []),
    path.join(codexHome, 'generated_images')
  ]);
  const images = createLiveImageMonitor({ roots: imageDirs, now: clock, scanMs: options.imageScanMs });
  const states = new Map();
  const fingerprints = new Map();
  let nextDiscovery = 0, nextPoll = 0, inflight = null, result = null, sourceAvailable = false;
  let discoveryErrors = 0;
  let releaseTimer = null;

  function release() {
    states.clear();
    fingerprints.clear();
    images.dispose();
    result = null;
    nextDiscovery = 0;
    nextPoll = 0;
    releaseTimer = null;
  }

  function scheduleRelease() {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, options.idleReleaseMs ?? IDLE_RELEASE_MS);
    releaseTimer.unref?.();
  }

  function newState(filename, stat) {
    return { offset: 0, mtime: stat.mtimeMs, birthtime: stat.birthtimeMs, lastGrowthAt: clock(), pending: '', dropping: false,
      decoder: new StringDecoder('utf8'), parser: createRecordParser(path.basename(filename, '.jsonl'), {
        minTimestamp: () => clock() - RECENT_MS
      }),
      events: [], readError: false };
  }

  async function discover(now) {
    const files = new Set(), visited = new Set();
    discoveryErrors = 0;
    sourceAvailable = false;
    async function visit(directory) {
      let entries;
      try {
        const real = await fs.promises.realpath(directory);
        if (visited.has(real)) return;
        visited.add(real);
        entries = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code !== 'ENOENT') discoveryErrors++;
        return;
      }
      for (const entry of entries) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(filename);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.add(filename);
      }
    }
    for (const root of roots) await visit(root);
    sourceAvailable = files.size > 0;
    // Discover resumed older chats too, regardless of their date directory.
    const candidates = [...files];
    let index = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < candidates.length) {
        const filename = candidates[index++];
        try {
          const stat = await fs.promises.stat(filename);
          const previous = fingerprints.get(filename);
          fingerprints.set(filename, { size: stat.size, mtime: stat.mtimeMs, birthtime: stat.birthtimeMs });
          if (states.has(filename)) continue;
          // On Windows, an open writer can append bytes while LastWriteTime
          // stays unchanged. Cold discovery therefore inspects the log tail;
          // later discoveries use size changes as well as modification time.
          const changed = previous && (previous.size !== stat.size || previous.mtime !== stat.mtimeMs || previous.birthtime !== stat.birthtimeMs);
          if (stat.mtimeMs > now - RECENT_MS || changed || (!previous && await hasRecentRecords(filename, stat, now))) {
            states.set(filename, newState(filename, stat));
          }
        } catch (error) { if (error.code !== 'ENOENT') discoveryErrors++; }
      }
    }));
    for (const filename of states.keys()) if (!files.has(filename)) states.delete(filename);
    for (const filename of fingerprints.keys()) if (!files.has(filename)) fingerprints.delete(filename);
    nextDiscovery = now + (options.discoveryMs ?? DISCOVERY_MS);
  }

  function consumeLine(state, line, now) {
    // Keep metadata and numeric usage only; never retain prompts/tool output.
    if (!line.includes('"token_count"') && !line.includes('"turn_context"') && !line.includes('"session_meta"')) return;
    let record;
    try { record = JSON.parse(line); } catch (_) { return; }
    state.parser.push(record);
    for (const event of state.parser.events.splice(0)) {
      if (event.timestamp > now - RECENT_MS) state.events.push(event);
    }
    state.parser.snapshots.length = 0;
  }

  function consumeChunk(state, buffer, now) {
    const parts = state.decoder.write(buffer).split('\n');
    for (let i = 0; i < parts.length; i++) {
      const complete = i < parts.length - 1;
      if (!state.dropping) {
        state.pending += parts[i];
        if (state.pending.length > MAX_LINE_LENGTH) { state.pending = ''; state.dropping = true; }
      }
      if (complete) {
        if (!state.dropping) consumeLine(state, state.pending, now);
        state.pending = '';
        state.dropping = false;
      }
    }
  }

  async function readFile(filename, now) {
    let state = states.get(filename);
    try {
      const stat = await fs.promises.stat(filename);
      if (stat.size < state.offset || stat.birthtimeMs !== state.birthtime ||
          (stat.mtimeMs !== state.mtime && stat.size === state.offset)) {
        state = newState(filename, stat);
        states.set(filename, state);
      }
      if (stat.size > state.offset) {
        state.lastGrowthAt = now;
        const stream = fs.createReadStream(filename, { start: state.offset, end: stat.size - 1 });
        for await (const buffer of stream) {
          consumeChunk(state, buffer, now);
          state.offset += buffer.length;
        }
        // A fully written JSON record without a final newline is also valid.
        if (state.pending && !state.dropping) {
          try { JSON.parse(state.pending); consumeLine(state, state.pending, now); state.pending = ''; }
          catch (_) { /* Preserve an incomplete record until the next append. */ }
        }
      }
      state.mtime = stat.mtimeMs;
      state.readError = false;
      state.events = state.events.filter(event => event.timestamp > now - RECENT_MS);
      state.parser.prune(now - RECENT_MS);
      if (Math.max(stat.mtimeMs, state.lastGrowthAt) <= now - RECENT_MS && !state.events.length) states.delete(filename);
    } catch (error) {
      if (error.code === 'ENOENT') states.delete(filename);
      else state.readError = true;
    }
  }

  async function poll() {
    const now = clock();
    if (now >= nextDiscovery) await discover(now);
    const filenames = [...states.keys()];
    let index = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < filenames.length) await readFile(filenames[index++], now);
    }));
    const readErrors = discoveryErrors + [...states.values()].filter(state => state.readError).length;
    const summary = summarizeUsage([...states.values()].flatMap(state => state.events), clock());
    const imageActivity = await images.getSnapshot();
    result = { ...summary, sourceAvailable, readErrors, imageActivity,
      status: readErrors ? 'partial' : !sourceAvailable ? 'unavailable' : summary.totals.requests ? 'active' : 'idle' };
    nextPoll = clock() + (options.pollMs ?? 900);
    return result;
  }

  return {
    getSnapshot() {
      clearTimeout(releaseTimer);
      if (inflight) return inflight;
      if (result && clock() < nextPoll) {
        const summary = summarizeUsage([...states.values()].flatMap(state => state.events), clock());
        scheduleRelease();
        return Promise.resolve({ ...result, ...summary, imageActivity: images.peek(),
          status: result.readErrors ? 'partial' : !result.sourceAvailable ? 'unavailable' : summary.totals.requests ? 'active' : 'idle' });
      }
      inflight = poll().finally(() => { inflight = null; scheduleRelease(); });
      return inflight;
    },
    getDiagnostics() {
      return { trackedFiles: states.size,
        retainedEvents: [...states.values()].reduce((sum, state) => sum + state.events.length, 0),
        retainedKeys: [...states.values()].reduce((sum, state) => sum + state.parser.retainedKeys(), 0),
        pendingCharacters: [...states.values()].reduce((sum, state) => sum + state.pending.length, 0) };
    },
    dispose() { clearTimeout(releaseTimer); release(); }
  };
}

const monitor = createLiveMonitor();
module.exports = { createLiveMonitor, summarizeUsage, getLiveCodexUsage: () => monitor.getSnapshot() };
