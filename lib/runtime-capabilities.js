'use strict';

const { builtinModules } = require('node:module');
const zlib = require('node:zlib');

function getRuntimeCapabilities() {
  const sqlite = builtinModules.includes('node:sqlite') || builtinModules.includes('sqlite');
  const zstandard = typeof zlib.createZstdDecompress === 'function';
  const maintained = [22, 24, 26].includes(Number(process.versions.node.split('.')[0]));
  return { node: process.versions.node, platform: process.platform, sqlite, zstandard,
    complete: sqlite && zstandard, maintained, supportedLtsMajors: [22, 24, 26], recommendedRuntime: 'Node.js 24 / 26 LTS (latest patch)',
    limitations: [
      ...(!maintained ? ['当前 Node.js 不在已验证的维护中 LTS 系列中；Node.js 20 已结束上游支持，建议升级至 Node.js 24 / 26 最新修订版。'] : []),
      ...(!sqlite ? ['当前运行时无法读取 ZCode SQLite 数据；建议使用 Node.js 24+。'] : []),
      ...(!zstandard ? ['当前运行时无法读取 Codex .jsonl.zst 归档；存在归档时刷新会保留旧数据并报告失败。'] : [])
    ] };
}

module.exports = { getRuntimeCapabilities };
