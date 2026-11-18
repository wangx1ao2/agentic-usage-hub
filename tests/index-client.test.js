'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createIndexClient } = require('../lib/index-client');
const workerFile = path.join(__dirname, 'fixtures', 'index-worker.cjs');

test('observation timeout keeps the same indexing operation alive and concurrent readers share one job', async t => {
  const client = createIndexClient({ workerFile }); t.after(() => client.dispose());
  const args = { delay: 100 };
  await assert.rejects(client.query('snapshot', args, { maxWaitMs: 1 }), error => error.statusCode === 503);
  const [a, b] = await Promise.all([client.query('snapshot', args), client.query('snapshot', args)]);
  assert.equal(a.calls, 1);
  assert.equal(b.calls, 1);
});

test('cache expiry reports stale data without extending its successful read time and refresh invalidation cannot resurrect old results', async t => {
  let now = 100;
  const client = createIndexClient({ workerFile, now: () => now }); t.after(() => client.dispose());
  const args = { delay: 30 };
  const first = await client.query('snapshot', args, { ttlMs: 10 });
  now += 11;
  const stale = await client.query('snapshot', args, { ttlMs: 10 });
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.refreshing, true);
  assert.equal(stale.meta.lastSuccessfulAt, first.meta.lastSuccessfulAt);
  client.invalidate();
  await client.call('snapshot', args); // verified live operation, not a blind sleep
  const next = await client.query('snapshot', args);
  assert.equal(next.calls, 3, 'The invalidated second result must not populate a fresh cache entry');
});

test('a terminal worker exit rejects pending reads and a later request starts a new worker', async t => {
  const client = createIndexClient({ workerFile }); t.after(() => client.dispose());
  await assert.rejects(client.call('crash'), /exited/);
  assert.equal((await client.query('snapshot')).calls, 1);
});

test('a cold loading snapshot is replaced promptly without manual invalidation', async t => {
  let now = 100;
  const client = createIndexClient({ workerFile, now: () => now }); t.after(() => client.dispose());
  const args = { loading: true };
  const first = await client.query('snapshot', args);
  assert.equal(first.meta.sourceSelectionMode, 'pending');
  now += 1001;
  assert.equal((await client.query('snapshot', args)).meta.refreshing, true);
  await client.call('snapshot', args);
  const complete = await client.query('snapshot', args);
  assert.equal(complete.calls, 2);
  assert.equal(complete.meta.sourceSelectionMode, 'selected-agents');
  assert.equal(complete.meta.refreshing, false);
});
