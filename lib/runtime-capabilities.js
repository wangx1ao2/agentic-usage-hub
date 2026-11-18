'use strict';

const { builtinModules } = require('node:module');
const zlib = require('node:zlib');

function getRuntimeCapabilities() {
  const sqlite = builtinModules.includes('node:sqlite') || builtinModules.includes('sqlite');
  const zstandard = typeof zlib.createZstdDecompress === 'function';
  return { node: process.versions.node, platform: process.platform, sqlite, zstandard,
    complete: sqlite && zstandard, recommendedRuntime: 'Node.js 24+',
    limitations: [
      ...(!sqlite ? ['当前运行时无法读取 ZCode SQLite 数据；建议使用 Node.js 24+。'] : []),
      ...(!zstandard ? ['当前运行时无法读取 Codex .jsonl.zst 归档；存在归档时刷新会保留旧数据并报告失败。'] : [])
    ] };
}

module.exports = { getRuntimeCapabilities };
