// Isolated module benchmark, not whole-dashboard/browser memory.
// Run: node --expose-gc tests/codex-live-benchmark.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { performance } = require('perf_hooks');
const { createLiveMonitor } = require('../lib/codex-live-usage');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-live-benchmark-'));
  let monitor;
  try {
    const filename = path.join(root, 'large.jsonl'), now = Date.now();
    const fd = fs.openSync(filename, 'w');
    function token(index, timestamp) {
      return JSON.stringify({ type: 'event_msg', timestamp: new Date(timestamp).toISOString(),
        payload: { type: 'token_count', info: {
          total_token_usage: { input_tokens: index * 1000, cached_input_tokens: index * 800, output_tokens: index * 100, total_tokens: index * 1100 },
          last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100, total_tokens: 1100 }
        } } }) + '\n';
    }
    try {
      fs.writeSync(fd, JSON.stringify({ type: 'session_meta', payload: { id: 'benchmark', cwd: '/benchmark' } }) + '\n');
      fs.writeSync(fd, JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }) + '\n');
      for (let index = 1; index <= 20000; index++) fs.writeSync(fd, token(index, now - 86_400_000 + index));
      fs.writeSync(fd, '{"type":"response_item","payload":{"content":"');
      for (let chunk = 0; chunk < 384; chunk++) fs.writeSync(fd, 'x'.repeat(65536));
      fs.writeSync(fd, '"}}\n');
      for (let index = 1; index <= 60; index++) fs.writeSync(fd, token(20000 + index, now - index * 900));
    } finally { fs.closeSync(fd); }
    const size = fs.statSync(filename).size;
    monitor = createLiveMonitor({ roots: [root], now: () => now, pollMs: 0 });
    global.gc?.();
    const baseline = process.memoryUsage().heapUsed;
    const coldStart = performance.now();
    let result = await monitor.getSnapshot();
    const coldMs = performance.now() - coldStart;
    global.gc?.();
    const liveHeap = process.memoryUsage().heapUsed - baseline;
    const warmStart = performance.now();
    for (let poll = 0; poll < 100; poll++) result = await monitor.getSnapshot();
    const warmMs = (performance.now() - warmStart) / 100;
    assert.equal(result.totals.requests, 60);
    const retained = monitor.getDiagnostics();
    assert.equal(retained.retainedKeys, 60);
    monitor.dispose();
    result = null;
    global.gc?.();
    console.log(JSON.stringify({ logSizeMiB: +(size / 1048576).toFixed(2), historicalRequests: 20000,
      coldReadMs: +coldMs.toFixed(2), meanUnchangedPollMs: +warmMs.toFixed(2),
      retainedHeapDeltaKiB: +(liveHeap / 1024).toFixed(2),
      heapDeltaAfterDisposeKiB: +((process.memoryUsage().heapUsed - baseline) / 1024).toFixed(2),
      retained, afterDispose: monitor.getDiagnostics(), scope: 'isolated-live-module-heap-not-total-dashboard-memory' }, null, 2));
  } finally {
    monitor?.dispose();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
