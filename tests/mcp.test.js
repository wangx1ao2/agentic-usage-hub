const test = require('node:test');
const assert = require('node:assert/strict');
const mcp = require('../mcp/server.js');

test('MCP Server: handleInitialize returns standard protocol capabilities', () => {
  const res = mcp.handleInitialize('init-1', {});
  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 'init-1');
  assert.equal(res.result.protocolVersion, '2024-11-05');
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.name, 'agentic-usage-hub');
});

test('MCP Server: handleToolsList returns all 3 telemetry tools', () => {
  const res = mcp.handleToolsList('list-1');
  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 'list-1');
  assert.ok(Array.isArray(res.result.tools));
  const toolNames = res.result.tools.map(t => t.name);
  assert.ok(toolNames.includes('get_usage_today'));
  assert.ok(toolNames.includes('get_usage_range'));
  assert.ok(toolNames.includes('get_project_breakdown'));
});

test('MCP Server: get_usage_today executes and returns structured JSON', () => {
  const res = mcp.handleToolCall('call-1', {
    name: 'get_usage_today',
    arguments: { tier: 'standard' }
  });
  assert.equal(res.jsonrpc, '2.0');
  assert.equal(res.id, 'call-1');
  assert.ok(res.result);
  assert.equal(res.result.content[0].type, 'text');
  const parsed = JSON.parse(res.result.content[0].text);
  assert.ok('totalTokens' in parsed);
  assert.ok('totalCostUSD' in parsed);
  assert.ok('activeModels' in parsed);
});

test('MCP Server: get_usage_range executes with grouping', () => {
  const res = mcp.handleToolCall('call-2', {
    name: 'get_usage_range',
    arguments: { groupBy: 'company' }
  });
  assert.equal(res.jsonrpc, '2.0');
  assert.ok(res.result);
  const parsed = JSON.parse(res.result.content[0].text);
  assert.equal(parsed.groupBy, 'company');
  assert.ok(Array.isArray(parsed.breakdown));
});

test('MCP Server: get_project_breakdown executes with limit', () => {
  const res = mcp.handleToolCall('call-3', {
    name: 'get_project_breakdown',
    arguments: { limit: 5 }
  });
  assert.equal(res.jsonrpc, '2.0');
  assert.ok(res.result);
  const parsed = JSON.parse(res.result.content[0].text);
  assert.ok(Array.isArray(parsed.projects));
  assert.ok(parsed.returned <= 5);
});

test('MCP Server: returns 32601 on unknown tool call', () => {
  const res = mcp.handleToolCall('call-err', {
    name: 'unknown_tool',
    arguments: {}
  });
  assert.equal(res.error.code, -32601);
});
