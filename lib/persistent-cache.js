'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { threadId } = require('node:worker_threads');
const { cacheDir, codexHome } = require('./config');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let revision = 0, runtimeIdentity;

// Versioned by the actual parser/aggregation code, catalog, roots and options.
// A release or a changed source/pricing configuration cannot reuse old results.
function getRuntimeIdentity() {
  if (!runtimeIdentity) {
    const code = ['log-parsers.js', 'request-record.js', 'usage-record.js', 'usage-aggregate.js',
      'record-reconciliation.js', 'codex-request-usage.js', 'codex-quota-history.js', 'codex-input.js',
      'image-index.js', 'zcode-source.js', 'usage-service.js', 'pricing-history.js', 'project-records.js',
      'file-cache.js', 'source-index.js', 'persistent-cache.js', 'codex-loader.js', 'ccusage-normalize.js',
      'date.js', 'project-path.js', 'jsonl-reader.js', 'business-api-usage.js', 'codex-account-quota.js', 'log-sources.js', '../models-pricing.js']
      .map(filename => fs.readFileSync(path.join(__dirname, filename), 'utf8'));
    const settings = new Set(['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SESSIONS_DIR', 'GROK_HOME', 'GROK_CONFIG_DIR',
      'QWEN_SESSIONS_DIR', 'QWEN_USAGE_FILE', 'QWEN_USD_CNY_RATE', 'QODER_SESSIONS_DIR',
      'QODER_EST_IN_CHARS_PER_TOKEN', 'QODER_EST_OUT_CHARS_PER_TOKEN', 'ZCODE_DB_PATH',
      'ANTIGRAVITY_SESSIONS_DIR', 'OPENCLAW_SESSIONS_DIR', 'REASONIX_USAGE_FILE', 'CODEX_IMAGE_DIRS',
      'CODEX_IMAGE_DIR', 'DEFAULT_SUBSCRIPTION_PLAN', 'DEFAULT_SUBSCRIPTION_FEE', 'DEFAULT_WEEKLY_ALLOWANCE', 'BUSINESS_API_PROJECTS',
      'CODEX_QUOTA_BIN', 'CODEX_ACCOUNT_QUOTA_ENABLED', 'CODEX_ACCOUNT_QUOTA_DISABLED', 'CODEX_AUTO_REVIEW_RATE_MODEL', 'TZ']);
    const environment = Object.entries(process.env).filter(([name]) => settings.has(name)).sort(([a], [b]) => a.localeCompare(b));
    runtimeIdentity = hash([1, process.versions.node, code, require('../models-pricing').MODEL_CATALOG, codexHome,
      require('node:os').homedir(), Intl.DateTimeFormat().resolvedOptions().timeZone, environment]);
  }
  return runtimeIdentity;
}

function snapshotPath(namespace, identity) {
  return path.join(cacheDir, 'indexes', namespace, `${hash(identity)}.json`);
}

function readSnapshot(filename, identity, io = fs) {
  try {
    const saved = JSON.parse(io.readFileSync(filename, 'utf8'));
    return saved?.version === 1 && saved.identity === identity && saved.checksum === hash(saved.data) ? saved.data : null;
  } catch (_) { return null; }
}

function writeSnapshot(filename, identity, data, io = fs) {
  const temporary = `${filename}.${process.pid}.${threadId}.${++revision}.tmp`;
  try {
    io.mkdirSync(path.dirname(filename), { recursive: true });
    io.writeFileSync(temporary, JSON.stringify({ version: 1, identity, checksum: hash(data), data }));
    io.renameSync(temporary, filename);
    return null;
  } catch (error) {
    try { io.unlinkSync(temporary); } catch (_) {}
    return error.message;
  }
}

module.exports = { hash, getRuntimeIdentity, snapshotPath, readSnapshot, writeSnapshot };
