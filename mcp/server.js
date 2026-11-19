#!/usr/bin/env node

/**
 * Agentic Usage Hub — Model Context Protocol (MCP) Stdio Server
 * Exposes token telemetry, cost analytics, and project attribution as tools
 * for AI coding assistants (Claude Code, Cursor, Windsurf, Claude Desktop).
 */

const readline = require('readline');
const { queryDashboard, queryProjects, startWarmup } = require('../lib/usage-service');
const { isObject, validateToolArguments } = require('../lib/validation');
const pkg = require('../package.json');

// Support the handshake protocol family without pretending to implement the
// newer stateless server/discover lifecycle. Auto clients can fall back here.
const PROTOCOL_VERSION = '2025-11-25';
const HANDSHAKE_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', PROTOCOL_VERSION]);

const TOOLS = [
  {
    name: 'get_usage_today',
    description: 'Get today\'s logged or estimated token counts, cache reads, USD cost reference and model/source breakdown. QoderWork and Antigravity token counts are estimates; this query reports daily totals, not streaming throughput.',
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
    description: 'Get historical token usage and estimated USD cost for a specific date range, grouped by AI company/vendor or by individual model. QoderWork and Antigravity token counts are heuristic estimates; actualOnly excludes them. Inferred reference models do not identify the model actually served.',
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
    description: 'Get token consumption and cost attribution grouped by local workspace path.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Maximum number of top projects to return (default: 10)'
        }
      }
    }
  }
];
for (const tool of TOOLS) {
  tool.inputSchema.additionalProperties = false;
  Object.assign(tool.inputSchema.properties, {
    actualOnly: { type: 'boolean', description: 'Keep logged token counts and exclude body-based token estimates.' },
    pricingMode: { type: 'string', enum: ['recorded', 'current'], description: 'Recorded/first-index prices, or selected catalog recalculation.' },
    pricingVersion: { type: 'string', pattern: '^catalog-[a-f0-9]{24}$', description: 'Saved catalog version; requires current mode.' }
  });
  if (tool.name !== 'get_usage_today') Object.assign(tool.inputSchema.properties, {
    tier: { type: 'string', enum: ['standard', 'flagship'] },
    agent: { type: 'string', enum: ['all', 'codex', 'claude', 'grok', 'zcode', 'qwen', 'qoderwork', 'antigravity', 'openclaw', 'reasonix', 'api'] },
    startDate: { type: 'string', description: 'Inclusive YYYY-MM-DD' }, endDate: { type: 'string', description: 'Inclusive YYYY-MM-DD' }
  });
}

function handleInitialize(id, params) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: HANDSHAKE_VERSIONS.has(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSION,
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

async function handleToolCall(id, params) {
  try {
    if (!isObject(params) || typeof params.name !== 'string') {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call requires an object with a tool name' } };
    }
    const { name } = params;
    const args = validateToolArguments(name, params.arguments);
    if (name === 'get_usage_today') {
      const tier = args.tier || 'standard';
      const data = await queryDashboard(tier, 'all', args);
      const today = data.todaySummary || {};

      const modelsSummary = Object.entries(today.byModel || {}).map(([mName, m]) => ({
        model: mName,
        company: m.company,
        costUSD: m.unpriced && !m.cost ? null : +Number(m.cost || 0).toFixed(6),
        totalTokens: m.tokens || 0,
        cacheTokens: m.cacheTokens || 0,
        agents: m.agents || [m.agent], bySource: m.bySource || {}, unpriced: !!m.unpriced, estimated: !!m.estimated,
        costComplete: m.costComplete !== false && !m.unpriced, unpricedTokens: m.unpricedTokens || 0
      }));

      const report = {
        date: today.date,
        totalCostUSD: today.totalCost,
        totalTokens: today.totalTokens,
        cacheReadTokens: today.cacheReadTokens,
        inputTokens: today.inputTokens,
        outputTokens: today.outputTokens,
        costComplete: !today.unpricedTokens && modelsSummary.every(row => row.costComplete),
        unpricedTokens: today.unpricedTokens || 0,
        generatedImages: today.images || { count: 0, cost: 0 },
        activeModels: modelsSummary,
        meta: data.meta
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
      const data = await queryDashboard(args.tier || 'standard', args.agent || 'all', args);
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

      const groups = Object.create(null);
      for (const day of filtered) {
        for (const [mName, mData] of Object.entries(day.byModel || {})) {
          const key = groupBy === 'model' ? mName : (mData.company || 'Unknown');
          if (!groups[key]) {
            groups[key] = { name: key, totalCostUSD: 0, totalTokens: 0, cacheTokens: 0,
              costComplete: true, unpricedTokens: 0, agents: [], bySource: Object.create(null) };
          }
          groups[key].totalCostUSD += (mData.cost || 0);
          groups[key].totalTokens += (mData.tokens || 0);
          groups[key].cacheTokens += (mData.cacheTokens || 0);
          groups[key].costComplete &&= mData.costComplete !== false && !mData.unpriced;
          groups[key].unpricedTokens += mData.unpricedTokens || 0;
          for (const [source, metrics] of Object.entries(mData.bySource || {})) {
            if (!groups[key].agents.includes(source)) groups[key].agents.push(source);
            const target = groups[key].bySource[source] ||= { tokens: 0, cost: 0, cacheTokens: 0 };
            target.tokens += metrics.tokens || 0; target.cost += metrics.cost || 0; target.cacheTokens += metrics.cacheTokens || 0;
          }
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
        costComplete: breakdown.every(row => row.costComplete),
        unpricedTokens: breakdown.reduce((sum, row) => sum + row.unpricedTokens, 0),
        groupBy,
        breakdown,
        meta: data.meta
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
      const limit = args.limit || 10;
      const { limit: _, ...filters } = args;
      const projects = await queryProjects(filters);
      const list = (projects || []).slice(0, limit);
      const grandCost = (projects || []).reduce((s, p) => s + (p.totalCost || 0), 0);

      const report = {
        totalProjects: (projects || []).length,
        returned: list.length,
        projects: list.map(p => ({
          id: p.id,
          name: p.name,
          primaryPath: p.primaryPath,
          pathCount: p.pathCount,
          totalTokens: p.totalTokens,
          formattedTokens: p.formattedTokens,
          totalCostUSD: p.totalCost,
          costSharePercent: grandCost > 0 ? +((p.totalCost / grandCost) * 100).toFixed(1) : 0,
          agents: p.agents,
          topModels: p.topModels,
          lastActive: p.lastActive,
          todayTokens: p.todayTokens, todayCostUSD: p.todayCost, daily: p.daily,
          attribution: p.attribution, requestCount: p.requestCount, costComplete: p.costComplete,
          estimatedTokens: p.estimatedTokens
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
        code: err.code === -32602 || err.statusCode === 400 ? -32602 : -32603,
        message: err.message
      }
    };
  }
}

async function handleMessage(message) {
  const validId = value => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method
    || (Object.hasOwn(message, 'id') && !validId(message.id))) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
  }
  const { id, method, params } = message;
  const notification = !Object.hasOwn(message, 'id');
  if (params !== undefined && !isObject(params)) {
    return notification ? null : { jsonrpc: '2.0', id, error: { code: -32602, message: 'params must be an object' } };
  }
  if (notification) return null;
  switch (method) {
    case 'initialize': return handleInitialize(id, params);
    case 'ping': return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list': return handleToolsList(id);
    case 'tools/call': return handleToolCall(id, params);
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

function startServer() {
  // Use the same bounded background snapshot query as the HTTP interface.
  startWarmup();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  rl.once('close', () => {
    require('../lib/usage-service').dispose().catch(error => process.stderr.write(`[MCP shutdown] ${error.message}\n`));
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

    handleMessage(message).then(response => {
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    }).catch(() => {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' } }) + '\n');
    });
  });

  process.stderr.write(`[agentic-usage-hub MCP] Stdio server initialized (v${pkg.version || '1.0.0'})\n`);
  return rl;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  handleInitialize,
  handleToolsList,
  handleToolCall,
  handleMessage,
  TOOLS
};
