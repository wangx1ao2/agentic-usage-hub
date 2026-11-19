'use strict';

const path = require('node:path');
const os = require('node:os');
const { parseLines } = require('./source-index');
const { createRequestRecord, timestampMs } = require('./request-record');
const { getLocalDateStr } = require('./date');
const { resolveModelInfo } = require('../models-pricing');
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

function parseUsageLog(source, content, filename) {
  const records = new Map();
  let cwd = '', undatedRecords = 0;
  const diagnostics = parseLines(content, (row, line) => {
    if (typeof row.cwd === 'string') cwd = row.cwd;
    const usage = row.usageMetadata || row.message?.usageMetadata || row.message?.usage || row.usage;
    const flat = source === 'qwen' && (typeof row.promptTokens === 'number' || typeof row.completionTokens === 'number');
    if (!usage && !flat) return;
    const u = usage || {}, cached = positive(u.cachedContentTokenCount ?? u.cache_read_input_tokens ?? u.cacheReadTokens
      ?? u.prompt_tokens_details?.cached_tokens ?? row.cacheHitTokens);
    const input = positive(flat ? row.promptTokens : u.promptTokenCount ?? u.input_tokens ?? u.inputTokens ?? u.prompt_tokens);
    const write = source === 'claude' ? positive(u.cache_creation_input_tokens
      ?? (positive(u.cache_creation?.ephemeral_5m_input_tokens) + positive(u.cache_creation?.ephemeral_1h_input_tokens)))
      : source === 'qwen' ? positive(u.prompt_tokens_details?.cache_creation_input_tokens ?? u.cache_creation_input_tokens) : 0;
    if (source === 'qwen' && cached + write > input) throw new Error('Qwen cache components exceed total prompt tokens');
    const output = positive(flat ? row.completionTokens : u.candidatesTokenCount ?? u.output_tokens ?? u.outputTokens ?? u.completion_tokens)
      + positive(u.thoughtsTokenCount);
    if (!(input + output + cached + write)) return;
    const rawModel = row.model || row.modelId || row.message?.model || 'unknown';
    const info = resolveModelInfo(rawModel, source);
    const sessionId = row.sessionId || row.session_id || path.basename(filename, '.jsonl');
    const messageId = row.message?.id || row.id || row.uuid || line;
    // Claude can reuse a message ID across distinct API requests. Only streaming
    // snapshots of the same (requestId, messageId) pair replace one another.
    const identity = source === 'claude' && typeof row.requestId === 'string' && row.requestId
      ? 'request:' + JSON.stringify([row.requestId, messageId]) : messageId;
    const key = `${row.sessionId || row.session_id || filename}:${identity}`;
    const amount = row.costUsd ?? row.costUSD ?? u.costUsd ?? row.cost?.total;
    const reportedCost = (typeof amount === 'number' || typeof amount === 'string' && amount.trim() !== '')
      && Number.isFinite(Number(amount)) && Number(amount) >= 0;
    const record = createRequestRecord({ source, id: key, rawModel,
      model: source === 'qwen' ? `${info.canonicalName} (Qwen)` : info.canonicalName,
      timestamp: row.timestamp ?? row.ts ?? row.created_at,
      date: row.date,
      sessionId, projectPath: row.cwd || row.projectPath || row.message?.cwd
        || (source === 'claude' || path.basename(filename) !== 'usage.jsonl' ? cwd : ''),
      inputTokens: source === 'claude' ? input : Math.max(0, input - cached - write),
      cacheReadTokens: cached, cacheWriteTokens: write, outputTokens: output,
      totalTokens: source === 'claude' ? input + cached + write + output : positive(u.totalTokenCount ?? u.total_tokens) || input + output,
      pricingContext: { ...(source === 'claude' ? { usageIdentity: typeof row.requestId === 'string' && row.requestId
        ? 'request-and-message-id' : /^(?:msg_|resp_)/.test(String(messageId)) ? 'session-message-id' : 'session-gateway-message-id',
        ...(u.cache_creation ? { cacheWrite: { shortTokens:positive(u.cache_creation.ephemeral_5m_input_tokens),
          longTokens:positive(u.cache_creation.ephemeral_1h_input_tokens) } } : {}) } : {}),
        ...(source === 'qwen' ? require('./qwen-pricing').qwenUsageContext(row,u,write) : {}),
        ...(row.serviceTier || row.service_tier || u.service_tier ? { serviceTier:row.serviceTier || row.service_tier || u.service_tier } : {}) },
      costUSD: reportedCost ? Number(amount) : undefined });
    if (!record) { undatedRecords++; return; }
    // Streaming snapshots of one message replace its earlier, smaller usage.
    if (!records.has(key) || records.get(key).totalTokens <= record.totalTokens) records.set(key, record);
  });
  return { records: [...records.values()], ...diagnostics, undatedRecords };
}

function contentChars(message) {
  if (!message) return 0;
  if (typeof message === 'string') return message.length;
  if (Array.isArray(message)) return contentChars({ content: message });
  if (typeof message.content === 'string') return message.content.length;
  if (!Array.isArray(message.content)) return 0;
  let count = 0;
  for (const block of message.content) {
    if (!block || typeof block !== 'object') continue;
    count += typeof block.text === 'string' ? block.text.length : 0;
    count += typeof block.thinking === 'string' ? block.thinking.length : 0;
    count += typeof block.content === 'string' ? block.content.length : Array.isArray(block.content) ? contentChars({ content: block.content }) : 0;
    if (block.input && typeof block.input === 'object') count += JSON.stringify(block.input).length;
  }
  return count;
}

function parseQoder(content, filename, stat = {}) {
  const records = [], seenUsers = new Set(), seenMessages = new Set();
  let context = 0, newInput = 0, projectPath = '', undatedRecords = 0;
  const inRatio = positive(process.env.QODER_EST_IN_CHARS_PER_TOKEN) || 2.8;
  const outRatio = positive(process.env.QODER_EST_OUT_CHARS_PER_TOKEN) || 3.2;
  const diagnostics = parseLines(content, (row, line) => {
    if (!projectPath && Array.isArray(row.directories)) {
      const home = os.homedir().replace(/\\/g, '/').toLowerCase();
      projectPath = row.directories.find(value => typeof value === 'string'
        && value.replace(/\\/g, '/').toLowerCase() !== home
        && !value.replace(/\\/g, '/').toLowerCase().includes('/.qoderworkcn/workspace')) || '';
    }
    if (row.type === 'user') {
      if (row.uuid && seenUsers.has(row.uuid)) return;
      if (row.uuid) seenUsers.add(row.uuid);
      const chars = contentChars(row.message) + contentChars(row.attachment);
      context += chars; newInput += chars; return;
    }
    if (row.type !== 'assistant') return;
    const message = row.message || {}, id = message.id || `line:${line}`;
    if (seenMessages.has(id)) return;
    seenMessages.add(id);
    const input = Math.round(context / inRatio), output = Math.round(contentChars(message) / outRatio);
    const cached = Math.min(input, Math.max(0, Math.round((context - newInput) / inRatio)));
    context += contentChars(message); newInput = 0;
    const info = resolveModelInfo(message.model || 'qmodel', 'qoderwork');
    const label = info.canonicalName === 'qwen3.8-flash' ? 'Qwen3.8 Flash' : info.canonicalName === 'qwen3.8-max' ? 'Qwen3.8 Max' : info.label;
    const timestamp = timestampMs(row.timestamp);
    if (timestamp === null) undatedRecords++;
    const record = createRequestRecord({ source: 'qoderwork', id: `${filename}:${id}`,
      rawModel: info.canonicalName, model: `${label} (QoderWork)`, timestamp: row.timestamp,
      date: timestamp === null && Number.isFinite(stat.mtimeMs) ? getLocalDateStr(new Date(stat.mtimeMs)) : undefined,
      dateBasis: 'file-modification-estimate',
      sessionId: row.sessionId || path.basename(filename, '.jsonl'), projectPath,
      inputTokens: input - cached, cacheReadTokens: cached, outputTokens: output, totalTokens: input + output,
      estimated: true, estimation: { inputCharsPerToken: inRatio, outputCharsPerToken: outRatio, context: 'cumulative-body' } });
    if (record) records.push(record);
  });
  return { records, ...diagnostics, undatedRecords };
}

function parseOpenClaw(source, content, filename) {
  const records = [], seen = new Set();
  let undatedRecords = 0;
  const diagnostics = parseLines(content, (row, line) => {
    const candidates = [row];
    for (const key of ['trajectory', 'messages', 'items']) if (Array.isArray(row.data?.[key])) candidates.push(...row.data[key]);
    for (let index = 0; index < candidates.length; index++) {
      const item = candidates[index];
      if (!item || typeof item !== 'object') continue;
      const u = item.usage;
      if (source === 'openclaw' && !u) continue;
      const usage = u || {};
      const cache = positive(source === 'reasonix' ? item.cacheHitTokens : usage.cacheRead ?? usage.cache_hit_tokens ?? usage.cache_read_tokens ?? usage.cache_read_input_tokens);
      const input = source === 'reasonix' ? positive(item.cacheMissTokens ?? (positive(item.promptTokens) - cache))
        : usage.input !== undefined ? positive(usage.input) : usage.input_tokens !== undefined ? positive(usage.input_tokens) : Math.max(0, positive(usage.prompt_tokens) - cache);
      const output = positive(source === 'reasonix' ? item.completionTokens : usage.output ?? usage.completion_tokens ?? usage.output_tokens);
      if (!(input + cache + output)) continue;
      const rawModel = item.model || row.modelId || row.model || 'unknown';
      const info = resolveModelInfo(rawModel, source);
      const key = String(item.request_id || item.id || `${filename}:${line}:${index}`);
      if (seen.has(key)) continue;
      seen.add(key);
      const cost = positive(source === 'reasonix' ? item.costUsd : typeof usage.cost === 'object' ? usage.cost?.total : usage.cost);
      const record = createRequestRecord({ source, id: key, rawModel,
        model: `${info.canonicalName} (${source === 'reasonix' ? 'Reasonix' : 'OpenClaw'})`,
        timestamp: item.timestamp ?? item.ts ?? row.timestamp ?? row.ts,
        sessionId: item.sessionId || row.sessionId || path.basename(filename, '.jsonl'),
        projectPath: item.cwd || item.directory || row.cwd || row.directory,
        inputTokens: input, cacheReadTokens: cache, outputTokens: output,
        totalTokens: positive(usage.totalTokens) || input + cache + output, costUSD: cost || undefined });
      if (record) records.push(record); else undatedRecords++;
    }
  });
  return { records, ...diagnostics, undatedRecords };
}

function parseAntigravity(content, filename) {
  const records = [];
  let undatedRecords = 0, lastDate = null;
  const diagnostics = parseLines(content, (row, line) => {
    const output = Math.round((contentChars(row.content) + contentChars(row.thinking)) / 3.5);
    const timestamp = timestampMs(row.created_at ?? row.timestamp);
    if (timestamp !== null) lastDate = getLocalDateStr(new Date(timestamp)); else undatedRecords++;
    const record = createRequestRecord({ source: 'antigravity', id: `${filename}:${row.id || line}`,
      rawModel: row.model || 'Gemini 3.7 Flash', timestamp: row.created_at ?? row.timestamp,
      date: timestamp === null ? lastDate : undefined, dateBasis: 'inherited-session-date-estimate',
      sessionId: path.basename(path.dirname(path.dirname(path.dirname(filename)))), projectPath: row.cwd || row.directory,
      inputTokens: 5500, cacheReadTokens: 16500, outputTokens: output, estimated: true,
      estimation: { inputPerStep: 22000, inputCacheShare: 0.75, outputCharsPerToken: 3.5 } });
    if (record) records.push(record);
  });
  return { records, ...diagnostics, undatedRecords };
}

module.exports = { parseUsageLog, parseQoder, parseOpenClaw, parseAntigravity, contentChars };
