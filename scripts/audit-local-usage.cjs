'use strict';

// Explicit local audit: retain only usage metadata in an ignored sandbox. Never
// copy prompts, responses, original session IDs or workspace paths into fixtures.
require('../lib/config');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { codexHome } = require('../lib/config');
const { parseRecords } = require('../lib/codex-request-usage');
const { parseUsageLog } = require('../lib/log-parsers');
const { createHash } = require('node:crypto');

function candidates(directory, output = []) {
  if (output.length >= 20) return output;
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a,b)=>b.name.localeCompare(a.name)); }
  catch (_) { return output; }
  for (const entry of entries) {
    if (output.length >= 20) break;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) candidates(filename, output);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(filename);
  }
  return output;
}
async function metadata(filename, alias, kind) {
  const rows = [];
  let pending = '', dropping = false, scanned = 0;
  const stream = fs.createReadStream(filename, { encoding: 'utf8' });
  const usage = value => value && Object.fromEntries(['input_tokens', 'cached_input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
    'output_tokens', 'reasoning_output_tokens', 'total_tokens'].filter(key => Number.isFinite(value[key]))
    .map(key => [key, value[key]]));
  function accept(line) {
    if (kind === 'codex' ? !/"(?:session_meta|turn_context|token_count|thread_settings_applied)"/.test(line) : !line.includes('"usage"')) return;
    let row;
    try { row = JSON.parse(line); } catch (_) { return; }
    if (kind === 'claude') {
      if (!row.message?.usage) return;
      // Upstream distinguishes Anthropic msg_/resp_ IDs from gateways that
      // reuse arbitrary IDs; preserve that format while removing the value.
      const id = value => value && (String(value).match(/^(?:msg_|resp_)/)?.[0] || '')
        + createHash('sha256').update(String(value)).digest('hex').slice(0,16);
      rows.push({ type: 'assistant', timestamp: row.timestamp, sessionId: alias,
        cwd: path.join(path.parse(filename).root,'audit-fixture',alias), requestId: id(row.requestId),
        message: { id: id(row.message.id), type: 'message', role: 'assistant', model: row.message.model,
          usage: { ...usage(row.message.usage), ...(row.message.usage.cache_creation ? {cache_creation:
            Object.fromEntries(['ephemeral_5m_input_tokens','ephemeral_1h_input_tokens']
              .filter(key=>Number.isFinite(row.message.usage.cache_creation[key]))
              .map(key=>[key,row.message.usage.cache_creation[key]]))} : {}) } } });
      return;
    }
    const payload = row.payload || {};
    if (row.type === 'session_meta') rows.push({ type: row.type, timestamp: row.timestamp,
      payload: { id: alias, cli_version: typeof payload.cli_version==='string' ? payload.cli_version : undefined,
        cwd: path.join(path.parse(filename).root, 'audit-fixture', alias),
        source: payload.source?.subagent ? { subagent: { other: 'audit-subagent' } } : 'cli' } });
    if (row.type === 'turn_context') rows.push({ type: row.type, timestamp: row.timestamp,
      payload: { model: payload.model, service_tier: payload.service_tier || payload.collaboration_mode?.settings?.service_tier } });
    if (row.type === 'event_msg' && payload.type === 'thread_settings_applied') rows.push({ type: row.type,
      timestamp: row.timestamp, payload: { type: payload.type, thread_settings: { service_tier: payload.thread_settings?.service_tier } } });
    if (row.type === 'event_msg' && payload.type === 'token_count') rows.push({ type: row.type,
      timestamp: row.timestamp, payload: { type: payload.type, info: payload.info ? {
        total_token_usage: usage(payload.info.total_token_usage), last_token_usage: usage(payload.info.last_token_usage) } : null } });
  }
  try {
    for await (const chunk of stream) {
      scanned += Buffer.byteLength(chunk);
      for (const part of chunk.split(/(?<=\n)/)) {
        if (!dropping) pending += part;
        if (pending.length > 256 * 1024) { pending = ''; dropping = true; }
        if (part.endsWith('\n')) { if (!dropping) accept(pending); pending = ''; dropping = false; }
      }
      if (scanned > 40 * 1024 * 1024 || rows.length > 2000) break;
    }
  } finally { stream.destroy(); }
  return rows;
}
async function main() {
  const sandbox = fs.mkdtempSync(path.join(path.resolve(__dirname, '..', 'tmp', 'stable-upgrade'), 'local-audit-'));
  const claudeRoot = process.env.CLAUDE_SESSIONS_DIR || path.join(require('node:os').homedir(),'.claude','projects');
  const sources = [{ kind:'codex', files:candidates(path.join(codexHome, 'sessions')) },
    { kind:'claude', files:candidates(claudeRoot) }];
  const cliPackage = require.resolve('ccusage/package.json');
  const cli = path.resolve(path.dirname(cliPackage), require(cliPackage).bin.ccusage);
  const results = [];
  for (const {kind,files} of sources) for (const filename of files) {
    const previous = results.filter(row=>row.source===kind).length;
    if (previous >= 3) break;
    const alias = `${kind}-sample-${previous+1}`;
    const rows = await metadata(filename, alias, kind);
    if (!rows.length || rows.find(row=>row.type==='session_meta')?.payload.source?.subagent) continue;
    const parsed = kind === 'codex' ? parseRecords(rows) : { events: parseUsageLog('claude',
      rows.map(row=>JSON.stringify(row)).join('\n')+'\n','sample.jsonl').records.map(row=>({ ...row, cacheCreationTokens:row.cacheWriteTokens })) };
    if (!parsed.events.length) continue;
    const home = path.join(sandbox, alias);
    const sessions = kind === 'codex' ? path.join(home, '.codex', 'sessions') : path.join(home,'.claude','projects',alias);
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'sample.jsonl'), rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home,'.codex'),
      CLAUDE_CONFIG_DIR: path.join(home,'.claude'), GROK_HOME: path.join(home,'.grok') };
    const native = JSON.parse(execFileSync(process.execPath,[cli,kind,'daily','--json','--offline'],
      { env, cwd: home, encoding:'utf8', timeout:30_000, maxBuffer:4*1024*1024 }));
    const fields = ['inputTokens','cacheReadTokens','outputTokens',...(kind==='claude'?['cacheCreationTokens']:[])];
    const expected = Object.fromEntries(fields.map(field=>[field,parsed.events.reduce((sum,row)=>sum+(row[field]||0),0)]));
    const actual = Object.fromEntries(fields.map(field=>[field,(native.daily||[]).reduce((sum,row)=>sum+(row[field]||0),0)]));
    const gatewayRows = kind === 'claude' ? rows.filter(row => !row.requestId && !/^(?:msg_|resp_)/.test(row.message.id || '')) : [];
    const rawGatewayCounts = Object.fromEntries(fields.map(field=>[field,rows.reduce((sum,row)=>sum+({inputTokens:row.message?.usage?.input_tokens,
      cacheReadTokens:row.message?.usage?.cache_read_input_tokens,cacheCreationTokens:row.message?.usage?.cache_creation_input_tokens,
      outputTokens:row.message?.usage?.output_tokens}[field]||0),0)]));
    results.push({ source:kind, sample:alias, metadataRows:rows.length, parsedRequests:parsed.events.length,
      fieldsMatch:fields.every(field=>expected[field]===actual[field]), expected, actual,
      ...(gatewayRows.length ? { identityLimitation:'requestless-gateway-id', gatewayRows:gatewayRows.length,
        nativeCountsEachSnapshot:fields.every(field=>rawGatewayCounts[field]===actual[field]) } : {}) });
  }
  const report = { source:'codex+claude', auditDate:new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai' }).format(new Date()), ccusageVersion:require(cliPackage).version,
    scope:'up to three metadata samples per source; Codex main sessions only; original logs read-only',
    samples:results, passed:results.length>0&&results.every(row=>row.fieldsMatch) };
  fs.writeFileSync(path.join(sandbox,'report.json'),JSON.stringify(report,null,2)+'\n');
  // Detailed counts stay local; console output can safely become public evidence.
  console.log(JSON.stringify({ source:report.source, ccusageVersion:report.ccusageVersion,
    samples:results.map(({sample,metadataRows,parsedRequests,fieldsMatch})=>({sample,metadataRows,parsedRequests,fieldsMatch})),
    passed:report.passed, reportDirectory:path.relative(path.resolve(__dirname,'..'),sandbox) },null,2));
  if(!report.passed) process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
