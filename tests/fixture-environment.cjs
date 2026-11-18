'use strict';
if (!require('node:worker_threads').isMainThread) return;

// Preloaded separately in every test process: never scan a developer's agent
// history or overwrite application caches when running the normal test suite.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const parent = path.resolve(os.tmpdir());
const root = fs.mkdtempSync(path.join(parent, 'agentic-test-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
Object.assign(process.env, {
  AGENTIC_CACHE_DIR: path.join(root, 'cache'),
  AGENTIC_DISABLE_DOTENV: '1',
  BUSINESS_API_PROJECTS: '',
  CODEX_ACCOUNT_QUOTA_DISABLED: '1',
  CODEX_HOME: path.join(root, '.codex'),
  CLAUDE_SESSIONS_DIR: path.join(root, '.claude', 'projects'),
  ZCODE_DB_PATH: path.join(root, '.zcode', 'cli', 'db', 'db.sqlite'),
  ANTIGRAVITY_SESSIONS_DIR: path.join(root, '.gemini', 'antigravity', 'brain'),
  CODEX_IMAGE_DIRS: path.join(root, '.codex', 'generated_images'),
  CODEX_IMAGE_DIR: path.join(root, '.codex', 'generated_images'),
  QWEN_SESSIONS_DIR: path.join(root, '.qwen', 'projects'),
  QWEN_USAGE_FILE: path.join(root, '.qwen', 'usage.jsonl'),
  QODER_SESSIONS_DIR: path.join(root, '.qoderworkcn', 'projects'),
  OPENCLAW_SESSIONS_DIR: path.join(root, '.openclaw', 'sessions'),
  REASONIX_USAGE_FILE: path.join(root, '.reasonix', 'usage.jsonl'),
  ANTIGRAVITY_USAGE_BIN: path.join(root, 'not-installed'),
  HOST: '127.0.0.1', TZ: 'Asia/Shanghai'
});
process.on('exit', () => {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) === parent && path.basename(resolved).startsWith('agentic-test-')) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
