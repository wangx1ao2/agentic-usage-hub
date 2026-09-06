#!/usr/bin/env node

/**
 * Agentic Usage Hub — Model Context Protocol (MCP) Stdio Server
 * Exposes token telemetry, cost analytics, and project attribution as tools
 * for AI coding assistants (Claude Code, Cursor, Windsurf, Claude Desktop).
 */

const readline = require('readline');
const { buildDashboardData } = require('../unified-server');
const projectAdapter = require('../project-adapter');
const pkg = require('../package.json');

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'get_usage_today',
    description: 'Get real-time token throughput, prompt cache hit rate, USD cost estimate, and model breakdown across all AI coding agents (Codex, Claude, Gemini/Antigravity, Grok, DeepSeek, ZCode) for today.',
    inputSchema: {
      type: 'object',
      properties: {
        tier: {
          type: 'string',
          enum: ['standard', 'flagship'],
          description: 'ZCode GLM pricing tier (default: "standard")'
        }
      }
    }
  },
  {
    name: 'get_usage_range',
    description: 'Get historical token usage and estimated USD cost for a specific date range, grouped by AI company/vendor or by individual model.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (inclusive)'
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive)'
        },
        groupBy: {
          type: 'string',
          enum: ['company', 'model'],
          description: 'Grouping dimension: "company" (OpenAI, Anthropic, Google, DeepSeek, Zhipu, etc.) or "model" (default: "company")'
        }
      }
    }
  },
  {
    name: 'get_project_breakdown',
    description: 'Get token consumption and cost attribution broken down by physical local workspace project and Git repository.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of top projects to return (default: 10)'
        }
      }
    }
  }
];

function handleInitialize(id, params) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: 'agentic-usage-hub',
        version: pkg.version || '1.0.0'
      }
    }
  };
}

function handleToolsList(id) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: TOOLS
    }
  };
}

function handleToolCall(id, params) {
  const { name, arguments: args = {} } = params || {};

  try {
    if (name === 'get_usage_today') {
      const tier = args.tier || 'standard';
      const data = buildDashboardData(tier, 'all');
      const today = data.todaySummary || {};

      const modelsSummary = Object.entries(today.byModel || {}).map(([mName, m]) => ({
        model: mName,
        company: m.company,
        costUSD: +Number(m.cost || 0).toFixed(4),
        totalTokens: m.tokens || 0,
        cacheTokens: m.cacheTokens || 0
      }));

      const report = {
        date: today.date,
        totalCostUSD: today.totalCost,
        totalTokens: today.totalTokens,
        cacheReadTokens: today.cacheReadTokens,
        inputTokens: today.inputTokens,
        outputTokens: today.outputTokens,
        generatedImages: today.images || { count: 0, cost: 0 },
        activeModels: modelsSummary
      };

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2)
            }
          ]
        }
      };
    }

    if (name === 'get_usage_range') {
      const { startDate, endDate, groupBy = 'company' } = args;
      const data = buildDashboardData('standard', 'all');
      const timeline = data.timeline || [];

      let filtered = timeline;
      if (startDate) {
        filtered = filtered.filter(d => d.date >= startDate);
      }
      if (endDate) {
        filtered = filtered.filter(d => d.date <= endDate);
      }

      const totalTokens = filtered.reduce((s, d) => s + (d.totalTokens || 0), 0);
      const totalCost = filtered.reduce((s, d) => s + (d.totalCost || 0), 0);
      const cacheReadTokens = filtered.reduce((s, d) => s + (d.cacheReadTokens || 0), 0);

      const groups = {};
      for (const day of filtered) {
        for (const [mName, mData] of Object.entries(day.byModel || {})) {
          const key = groupBy === 'model' ? mName : (mData.company || 'Unknown');
          if (!groups[key]) {
            groups[key] = { name: key, totalCostUSD: 0, totalTokens: 0, cacheTokens: 0 };
          }
          groups[key].totalCostUSD += (mData.cost || 0);
          groups[key].totalTokens += (mData.tokens || 0);
          groups[key].cacheTokens += (mData.cacheTokens || 0);
        }
      }

      const breakdown = Object.values(groups)
        .map(g => ({
          ...g,
          totalCostUSD: +g.totalCostUSD.toFixed(4)
        }))
        .sort((a, b) => b.totalCostUSD - a.totalCostUSD);

      const report = {
        range: { startDate: startDate || (filtered[0] ? filtered[0].date : null), endDate: endDate || (filtered[filtered.length - 1] ? filtered[filtered.length - 1].date : null) },
        daysCount: filtered.length,
        totalCostUSD: +totalCost.toFixed(4),
        totalTokens,
        cacheReadTokens,
        groupBy,
        breakdown
      };

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2)
            }
          ]
        }
      };
    }

    if (name === 'get_project_breakdown') {
      const limit = Math.max(1, Math.min(args.limit || 10, 50));
      const projects = projectAdapter.getProjectAttributionList();
      const list = (projects || []).slice(0, limit);

      const report = {
        totalProjects: (projects || []).length,
        returned: list.length,
        projects: list.map(p => ({
          name: p.name,
          category: p.category,
          path: p.path,
          totalTokens: p.totalTokens,
          formattedTokens: p.formattedTokens,
          totalCostUSD: p.totalCost,
          percentage: p.percentage + '%',
          agents: p.agents,
          topModels: p.topModels
        }))
      };

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(report, null, 2)
            }
          ]
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Tool not found: ${name}`
      }
    };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error executing tool "${name}": ${err.message}`
      }
    };
  }
}

function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (e) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' }
      }) + '\n');
      return;
    }

    const { id, method, params } = message;

    // Handle notifications (no response needed)
    if (!id && method && method.startsWith('notifications/')) {
      return;
    }

    let response;
    switch (method) {
      case 'initialize':
        response = handleInitialize(id, params);
        break;
      case 'ping':
        response = { jsonrpc: '2.0', id, result: {} };
        break;
      case 'tools/list':
        response = handleToolsList(id);
        break;
      case 'tools/call':
        response = handleToolCall(id, params);
        break;
      default:
        response = {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        };
        break;
    }

    process.stdout.write(JSON.stringify(response) + '\n');
  });

  process.stderr.write(`[agentic-usage-hub MCP] Stdio server initialized (v${pkg.version || '1.0.0'})\n`);
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  handleInitialize,
  handleToolsList,
  handleToolCall,
  TOOLS
};
