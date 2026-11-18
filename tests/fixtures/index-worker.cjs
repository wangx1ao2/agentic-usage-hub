'use strict';
const { parentPort } = require('node:worker_threads');
let calls = 0;
parentPort.on('message', async ({ id, operation, args }) => {
  const call = ++calls;
  await new Promise(resolve => setTimeout(resolve, args.delay || 0));
  if (operation === 'crash') process.exit(7);
  else if (args.fail) parentPort.postMessage({ id, error: { message: 'fixture failure', statusCode: 503 } });
  else parentPort.postMessage({ id, result: { calls: call, totals: { totalTokens: call }, meta: { stale: false, refreshing: !!args.loading && call === 1,
    sourceSelectionMode: args.loading && call === 1 ? 'pending' : 'selected-agents', lastSuccessfulAt: '2026-10-18T00:00:00Z' } } });
});
