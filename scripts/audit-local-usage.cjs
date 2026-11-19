'use strict';

// Explicit local audit: retain only usage metadata in an ignored sandbox. Never
// copy prompts, responses, original session IDs or workspace paths into fixtures.
require('../lib/config');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { codexHome } = require('../lib/config');
const { parseRecords } = require('../lib/codex-request-usage');

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
async function metadata(filename, alias) {
  const rows = [];
  let pending = '', dropping = false, scanned = 0;
  const stream = fs.createReadStream(filename, { encoding: 'utf8' });
  const usage = value => value && Object.fromEntries(['input_tokens', 'cached_input_tokens',
    'output_tokens', 'reasoning_output_tokens', 'total_tokens'].filter(key => Number.isFinite(value[key]))
    .map(key => [key, value[key]]));
  function accept(line) {
    if (!/"(?:session_meta|turn_context|token_count|thread_settings_applied)"/.test(line)) return;
    let row;
    try { row = JSON.parse(line); } catch (_) { return; }
    const payload = row.payload || {};
    if (row.type === 'session_meta') rows.push({ type: row.type, timestamp: row.timestamp,
      payload: { id: alias, cwd: path.join(path.parse(filename).root, 'audit-fixture', alias),
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
  const sources = candidates(path.join(codexHome, 'sessions'));
  const cliPackage = require.resolve('ccusage/package.json');
  const cli = path.resolve(path.dirname(cliPackage), require(cliPackage).bin.ccusage);
  const results = [];
  for (const filename of sources) {
    if (results.length >= 3) break;
    const alias = `sample-${results.length+1}`;
    const rows = await metadata(filename, alias);
    if (!rows.length || rows.find(row=>row.type==='session_meta')?.payload.source?.subagent) continue;
    const parsed = parseRecords(rows);
    if (!parsed.events.length) continue;
    const home = path.join(sandbox, alias);
    const sessions = path.join(home, '.codex', 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, 'sample.jsonl'), rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.dirname(sessions),
      CLAUDE_CONFIG_DIR: path.join(home,'.claude'), GROK_HOME: path.join(home,'.grok') };
    const native = JSON.parse(execFileSync(process.execPath,[cli,'codex','daily','--json','--offline'],
      { env, cwd: home, encoding:'utf8', timeout:30_000, maxBuffer:4*1024*1024 }));
    const fields = ['inputTokens','cacheReadTokens','outputTokens'];
    const expected = Object.fromEntries(fields.map(field=>[field,parsed.events.reduce((sum,row)=>sum+(row[field]||0),0)]));
    const actual = Object.fromEntries(fields.map(field=>[field,(native.daily||[]).reduce((sum,row)=>sum+(row[field]||0),0)]));
    results.push({ sample:alias, metadataRows:rows.length, parsedRequests:parsed.events.length,
      fieldsMatch:fields.every(field=>expected[field]===actual[field]), expected, actual });
  }
  const report = { source:'codex', auditDate:new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai' }).format(new Date()), ccusageVersion:require(cliPackage).version,
    scope:'up to three local main-session metadata samples; no prompts or responses copied; original logs read-only',
    samples:results, passed:results.length>0&&results.every(row=>row.fieldsMatch) };
  fs.writeFileSync(path.join(sandbox,'report.json'),JSON.stringify(report,null,2)+'\n');
  // Detailed counts stay local; console output can safely become public evidence.
  console.log(JSON.stringify({ source:report.source, ccusageVersion:report.ccusageVersion,
    samples:results.map(({sample,metadataRows,parsedRequests,fieldsMatch})=>({sample,metadataRows,parsedRequests,fieldsMatch})),
    passed:report.passed, reportDirectory:path.relative(path.resolve(__dirname,'..'),sandbox) },null,2));
  if(!report.passed) process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
