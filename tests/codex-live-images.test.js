const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLiveImageMonitor } = require('../lib/codex-live-images');
const { createLiveMonitor } = require('../lib/codex-live-usage');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-live-images-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function image(root, name, timestamp) {
  const filename = path.join(root, name);
  fs.writeFileSync(filename, Buffer.from([137, 80, 78, 71]));
  fs.utimesSync(filename, new Date(timestamp), new Date(timestamp));
}

test('image-only tasks show image activity without fabricating text or image token rates', async t => {
  const root = fixture(t), now = Date.now(), images = path.join(root, 'images');
  fs.mkdirSync(images);
  image(images, 'one.png', now - 1000);
  image(images, 'two.png', now - 90_000);
  image(images, 'old.png', now - 600_000);
  const monitor = createLiveMonitor({ roots: [path.join(root, 'no-text-logs')], imageDirs: [images], now: () => now });
  t.after(() => monitor.dispose());
  const result = await monitor.getSnapshot();
  assert.equal(result.totals.tokensPerSecond, 0);
  assert.equal(result.imageActivity.filesLastFiveMinutes, 2);
  assert.equal(result.imageActivity.filesLastMinute, 1);
  assert.equal(result.imageActivity.tokensPerSecond, null);
  assert.equal(result.imageActivity.tokenUsageAvailable, false);
  assert.equal(result.imageActivity.latestImageAt, now - 1000);
});

test('continued image output remains observable after text usage expires and across monitor restarts', async t => {
  const root = fixture(t);
  let now = Date.now();
  let monitor = createLiveMonitor({ roots: [], imageDirs: [root], now: () => now, pollMs: 0, imageScanMs: 0 });
  try {
    for (let index = 0; index < 5; index++) {
      image(root, `image-${index}.png`, now - 1);
      const result = await monitor.getSnapshot();
      assert.equal(result.totals.tokensPerSecond, 0);
      assert.equal(result.imageActivity.filesLastFiveMinutes, index + 1);
      assert.equal(result.imageActivity.latestImageAt, now - 1);
      now += 65_000;
    }
    monitor.dispose();
    monitor = createLiveMonitor({ roots: [], imageDirs: [root], now: () => now, imageScanMs: 0 });
    const restored = await monitor.getSnapshot();
    assert.equal(restored.imageActivity.filesLastFiveMinutes, 4);
    assert.equal(restored.imageActivity.tokensPerSecond, null);
  } finally { monitor.dispose(); }
});

test('image discovery is cached, window counts decay, and overlapping roots do not double count', async t => {
  const root = fixture(t);
  let now = Date.now();
  image(root, 'one.PNG', now - 59_999);
  const monitor = createLiveImageMonitor({ roots: [root, root], now: () => now, scanMs: 15000 });
  const first = await monitor.getSnapshot();
  assert.equal(first.filesLastMinute, 1);
  now += 2;
  const expired = await monitor.getSnapshot();
  assert.equal(expired.filesLastMinute, 0);
  assert.equal(expired.scannedAt, first.scannedAt);
  image(root, 'new.png', now - 1);
  assert.equal((await monitor.getSnapshot()).filesLastFiveMinutes, 1);
  now += 15_000;
  assert.equal((await monitor.getSnapshot()).filesLastFiveMinutes, 2);
  monitor.dispose();
});
