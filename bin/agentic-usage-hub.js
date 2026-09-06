#!/usr/bin/env node

/**
 * Agentic Usage Hub — CLI Executable
 * Enables zero-config launch via: npx agentic-usage-hub
 */

const { exec } = require('child_process');
const path = require('path');
const pkg = require('../package.json');

const args = process.argv.slice(2);

// Handle MCP Server flag
if (args.includes('--mcp')) {
  require('../mcp/server.js').startServer();
  return;
}

// Handle flags
if (args.includes('-h') || args.includes('--help')) {
  console.log(`
Agentic Usage Hub — v${pkg.version}
Multi-agent token telemetry and usage analytics dashboard for AI coding assistants.

Usage:
  npx agentic-usage-hub [options]

Options:
  -p, --port <port>   Set HTTP server port (default: 4242 or $PORT)
  -o, --open          Automatically open dashboard in your default browser
  --mcp               Start Model Context Protocol (MCP) stdio server
  -v, --version       Display version number
  -h, --help          Show this help message

Supported Agents:
  OpenAI Codex, Anthropic Claude, xAI Grok, Google Gemini, 智谱 ZCode, DeepSeek OpenClaw

Documentation:
  https://github.com/wangx1ao2/agentic-usage-hub
`);
  process.exit(0);
}

if (args.includes('-v') || args.includes('--version')) {
  console.log(`v${pkg.version}`);
  process.exit(0);
}

// Parse port flag
let customPort = null;
const portIdx = args.findIndex(a => a === '-p' || a === '--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  const parsed = parseInt(args[portIdx + 1], 10);
  if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
    customPort = parsed;
    process.env.PORT = String(customPort);
  } else {
    console.error(`Error: Invalid port number "${args[portIdx + 1]}". Must be between 1 and 65535.`);
    process.exit(1);
  }
}

const shouldOpen = args.includes('-o') || args.includes('--open');
const targetPort = customPort || process.env.PORT || 4242;

// Require and start unified server
require('../unified-server.js');

if (shouldOpen) {
  const url = `http://localhost:${targetPort}`;
  setTimeout(() => {
    const startCmd = process.platform === 'win32' ? `start "" "${url}"` :
      process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(startCmd, (err) => {
      // Silently ignore browser open errors in headless/CI environments
    });
  }, 1000);
}
