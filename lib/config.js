'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function loadEnv(filename = path.join(__dirname, '..', '.env')) {
  try {
    for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || Object.hasOwn(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') console.error('[config] Cannot read environment file:', error.code); }
}

if (process.env.AGENTIC_DISABLE_DOTENV !== '1') loadEnv();
const cacheDir = path.resolve(process.env.AGENTIC_CACHE_DIR || path.join(os.homedir(), '.cache', 'agentic-usage-hub'));
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));

module.exports = { loadEnv, cacheDir, codexHome };
