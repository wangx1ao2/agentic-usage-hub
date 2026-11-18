'use strict';

const fs = require('fs');
const path = require('path');

// Observe image files only. PNG metadata cannot reveal billed image tokens.
function createLiveImageMonitor(options = {}) {
  const roots = options.roots || [];
  const clock = options.now || Date.now;
  let recent = [], latestAt = null, scannedAt = null, nextScan = 0;
  let sourceAvailable = false, readErrors = 0, inflight = null;

  function snapshot() {
    const now = clock();
    return { basis: 'local-image-files', tokenUsageAvailable: false, tokensPerSecond: null,
      sourceAvailable, readErrors, scannedAt, latestImageAt: latestAt,
      filesLastMinute: recent.filter(time => time > now - 60_000 && time <= now).length,
      filesLastFiveMinutes: recent.filter(time => time > now - 300_000 && time <= now).length };
  }

  async function scan() {
    const now = clock(), files = new Set(), visited = new Set(), timestamps = [];
    sourceAvailable = false;
    readErrors = 0;
    latestAt = null;
    async function visit(directory) {
      let entries;
      try {
        const real = await fs.promises.realpath(directory);
        if (visited.has(real)) return;
        visited.add(real);
        entries = await fs.promises.readdir(real, { withFileTypes: true });
        sourceAvailable = true;
        for (const entry of entries) {
          const filename = path.join(real, entry.name);
          if (entry.isDirectory()) await visit(filename);
          else if (entry.isFile() && /\.png$/i.test(entry.name)) files.add(filename);
        }
      } catch (error) { if (error.code !== 'ENOENT') readErrors++; }
    }
    for (const root of roots) await visit(root);
    const candidates = [...files];
    let index = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < candidates.length) {
        const filename = candidates[index++];
        try {
          const stat = await fs.promises.stat(filename);
          if (!stat.size || stat.mtimeMs > now) continue;
          if (latestAt === null || stat.mtimeMs > latestAt) latestAt = stat.mtimeMs;
          if (stat.mtimeMs > now - 300_000) timestamps.push(stat.mtimeMs);
        } catch (error) { if (error.code !== 'ENOENT') readErrors++; }
      }
    }));
    recent = timestamps;
    scannedAt = clock();
    nextScan = scannedAt + (options.scanMs ?? 15_000);
    return snapshot();
  }

  return {
    getSnapshot() {
      if (inflight) return inflight;
      if (scannedAt !== null && clock() < nextScan) return Promise.resolve(snapshot());
      inflight = scan().finally(() => { inflight = null; });
      return inflight;
    },
    peek: snapshot,
    dispose() { recent = []; latestAt = null; scannedAt = null; nextScan = 0; }
  };
}

module.exports = { createLiveImageMonitor };
