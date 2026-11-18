'use strict';

require('./fixture-environment.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { server } = require('../unified-server');
const service = require('../lib/usage-service');
const { getLocalDateStr } = require('../lib/date');

async function main() {
  const rows = 24000;
  const dir = path.join(process.env.QWEN_SESSIONS_DIR, 'benchmark', 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'large.jsonl');
  const row = JSON.stringify({ timestamp: `${getLocalDateStr()}T12:00:00`, model: 'qwen-plus',
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }, text: 'x'.repeat(1024) }) + '\n';
  const fd = fs.openSync(filename, 'w');
  try { for (let index = 0; index < rows; index++) fs.writeSync(fd, row); }
  finally { fs.closeSync(fd); }
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const staticTimes = [];
  async function staticProbes() {
    for (let index = 0; index < 15; index++) {
      const start = performance.now();
      const response = await fetch(`${url}/styles.css`);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
      staticTimes.push(performance.now() - start);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  try {
    const coldStart = performance.now();
    const coldRequest = fetch(`${url}/api/dashboard`).then(response => response.json());
    await staticProbes();
    const cold = await coldRequest;
    const coldMs = performance.now() - coldStart;
    assert.equal(cold.totals.totalTokens, rows * 120);
    const warmStart = performance.now();
    for (let index = 0; index < 20; index++) await (await fetch(`${url}/api/dashboard`)).arrayBuffer();
    const warmMs = (performance.now() - warmStart) / 20;
    fs.appendFileSync(filename, row);
    const appendStart = performance.now();
    const refresh = fetch(`${url}/api/refresh`).then(response => response.json());
    await staticProbes();
    assert.equal((await refresh).success, true);
    const next = await (await fetch(`${url}/api/dashboard`)).json();
    const appendMs = performance.now() - appendStart;
    assert.equal(next.totals.totalTokens, (rows + 1) * 120);
    staticTimes.sort((a, b) => a - b);
    const report = { scope: 'isolated HTTP service with background worker; not personal log performance',
      node: process.versions.node, platform: process.platform, rows, fixtureMiB: +(fs.statSync(filename).size / 1048576).toFixed(2),
      coldDashboardMs: +coldMs.toFixed(2), unchangedDashboardMeanMs: +warmMs.toFixed(2), appendRefreshMs: +appendMs.toFixed(2),
      staticRequestP95Ms: +staticTimes[Math.floor(staticTimes.length * 0.95)].toFixed(2),
      eventLoopP99Ms: +(lag.percentile(99) / 1e6).toFixed(2) };
    assert.ok(report.staticRequestP95Ms < 1000, 'Static assets stalled while indexing');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    lag.disable();
    await service.dispose();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
