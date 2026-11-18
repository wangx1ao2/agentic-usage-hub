'use strict';
require('./config');
const path = require('node:path');
const os = require('node:os');
const { createSourceIndex } = require('./source-index');
const parsers = require('./log-parsers');
const home = (...parts) => path.join(os.homedir(), ...parts);

const sources = {
  api: require('./business-api-usage').createBusinessApiMonitor(),
  claude: createSourceIndex({ source: 'claude', paths: () => [process.env.CLAUDE_SESSIONS_DIR || home('.claude', 'projects')],
    parse: (content, filename) => parsers.parseUsageLog('claude', content, filename) }),
  qwen: createSourceIndex({ source: 'qwen', paths: () => [process.env.QWEN_SESSIONS_DIR || home('.qwen'),
    process.env.QWEN_USAGE_FILE || home('.qwen', 'usage.jsonl')],
    accept: filename => filename.endsWith('.jsonl') && (/(?:\/|\\)(chats|sessions)(?:\/|\\)/.test(filename) || filename.endsWith('usage.jsonl') || filename === path.resolve(process.env.QWEN_USAGE_FILE || home('.qwen', 'usage.jsonl'))),
    parse: (content, filename) => parsers.parseUsageLog('qwen', content, filename) }),
  qoderwork: createSourceIndex({ source: 'qoderwork', paths: () => [process.env.QODER_SESSIONS_DIR || home('.qoderworkcn', 'projects')], parse: parsers.parseQoder }),
  openclaw: createSourceIndex({ source: 'openclaw', paths: () => [process.env.OPENCLAW_SESSIONS_DIR || home('.openclaw', 'agents', 'main', 'sessions')],
    accept: filename => filename.endsWith('.trajectory.jsonl'), parse: (content, filename) => parsers.parseOpenClaw('openclaw', content, filename) }),
  reasonix: createSourceIndex({ source: 'reasonix', paths: () => [process.env.REASONIX_USAGE_FILE || home('.reasonix', 'usage.jsonl')],
    parse: (content, filename) => parsers.parseOpenClaw('reasonix', content, filename) }),
  antigravity: createSourceIndex({ source: 'antigravity', paths: () => [process.env.ANTIGRAVITY_SESSIONS_DIR || home('.gemini', 'antigravity', 'brain')],
    accept: filename => filename.endsWith(`${path.sep}transcript.jsonl`), parse: parsers.parseAntigravity })
};

module.exports = { sources };
