'use strict';

// Exercise the installed upstream CLI, rather than mocking its JSON contract.
require('../tests/fixture-environment.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { normalizeCcusageDaily } = require('../lib/ccusage-normalize');
const { selectUsageSources } = require('../lib/codex-loader');

const timestamp = '2026-11-17T04:00:00Z';
const usage = { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100,
  reasoning_output_tokens: 50, total_tokens: 1100 };
const session = path.join(process.env.CODEX_HOME, 'sessions', '2026', '11', '17', 'contract.jsonl');
fs.mkdirSync(path.dirname(session), { recursive: true });
const event = { type: 'event_msg', timestamp, payload: { type: 'token_count',
  info: { total_token_usage: usage, last_token_usage: usage } } };
fs.writeFileSync(session, [
  { type: 'session_meta', timestamp, payload: { id: 'contract-codex', cwd: path.dirname(session), source: 'cli' } },
  { type: 'turn_context', timestamp, payload: { model: 'gpt-6.1-sol' } }, event, event
].map(row => JSON.stringify(row)).join('\n') + '\n');
const claude = path.join(process.env.CLAUDE_SESSIONS_DIR, 'contract', 'session.jsonl');
fs.mkdirSync(path.dirname(claude), { recursive: true });
process.env.CLAUDE_CONFIG_DIR = path.dirname(process.env.CLAUDE_SESSIONS_DIR);
process.env.GROK_HOME = path.join(process.env.HOME, '.grok');
fs.writeFileSync(claude, JSON.stringify({ type: 'assistant', timestamp, sessionId: 'contract-claude',
  requestId: 'contract-request', message: { id: 'msg-contract', type: 'message', role: 'assistant',
    model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 10,
      cache_read_input_tokens: 50, cache_creation_input_tokens: 25 } } }) + '\n');
const cli = path.join(__dirname, '..', 'node_modules', 'ccusage', 'src', 'cli.js');
const raw = JSON.parse(execFileSync(process.execPath, [cli, 'daily', '--json', '--offline', '--by-agent'],
  { encoding: 'utf8', env: process.env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }));
const selected = selectUsageSources(raw);
const days = normalizeCcusageDaily(selected);
const rows = days.flatMap(day => day.modelBreakdowns).map(row => ({ source: row.agent, model: row.modelName,
  input: row.inputTokens, cacheRead: row.cacheReadTokens, cacheWrite: row.cacheCreationTokens,
  output: row.outputTokens, total: row.totalTokens })).sort((a, b) => a.source.localeCompare(b.source));
assert.equal(rows.find(row => row.source === 'codex')?.total, 1100, 'Codex repeated snapshots must count once');
assert.equal(rows.find(row => row.source === 'claude')?.total, 185, 'Claude cache writes must be preserved');
assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 1285);
console.log(JSON.stringify({ version: require('../node_modules/ccusage/package.json').version, rows }, null, 2));
