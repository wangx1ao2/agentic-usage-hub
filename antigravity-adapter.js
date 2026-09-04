const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let cache = null;
let lastFetch = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

let dailyCache = null;
let dailyCacheTime = 0;

function getAntigravityStatus(forceRefresh = false) {
  const now = Date.now();
  if (cache && !forceRefresh && (now - lastFetch < CACHE_TTL_MS)) {
    return cache;
  }

  try {
    const res = spawnSync('npx.cmd', ['antigravity-usage', '--json'], {
      timeout: 10000,
      shell: true,
      env: { ...process.env, NO_COLOR: '1' }
    });

    if (res.status === 0 && res.stdout) {
      const raw = JSON.parse(res.stdout.toString().trim());
      
      const monthlyCredits = raw.promptCredits?.monthly || 50000;
      const availableCredits = raw.promptCredits?.available || 0;
      const usedPercentage = raw.promptCredits?.usedPercentage ?? 0.99;
      const usedCredits = monthlyCredits * usedPercentage;

      const unifiedTokensPool = monthlyCredits * 1000; // 50,000,000 tokens
      const unifiedTokensUsed = Math.round(usedCredits * 1000); // 49,500,000 tokens
      const unifiedTokensRemaining = Math.round(availableCredits * 1000); // 500,000 tokens

      const unifiedCostPool = 20.00; // $20/month
      const unifiedCostUsed = +(unifiedCostPool * usedPercentage).toFixed(2); // $19.80
      const unifiedCostRemaining = +(unifiedCostPool - unifiedCostUsed).toFixed(2); // $0.20

      const models = (raw.models || []).map(m => ({
        label: m.label,
        modelId: m.modelId,
        remainingPercentage: +(m.remainingPercentage * 100).toFixed(1),
        remainingTokensEquivalent: Math.round(m.remainingPercentage * 10_000_000),
        resetTime: m.resetTime,
        timeUntilResetMs: m.timeUntilResetMs,
        isExhausted: m.isExhausted
      }));

      cache = {
        agent: 'antigravity',
        connected: true,
        email: raw.email || 'local-user',
        timestamp: raw.timestamp || new Date().toISOString(),
        tokens: {
          totalPool: unifiedTokensPool,
          used: unifiedTokensUsed,
          remaining: unifiedTokensRemaining,
          formattedTotal: (unifiedTokensPool / 1e6).toFixed(1) + 'M',
          formattedUsed: (unifiedTokensUsed / 1e6).toFixed(1) + 'M',
          formattedRemaining: (unifiedTokensRemaining / 1e6).toFixed(1) + 'M'
        },
        costUSD: {
          totalPool: unifiedCostPool,
          used: unifiedCostUsed,
          remaining: unifiedCostRemaining,
          formattedUsed: '$' + unifiedCostUsed.toFixed(2),
          formattedRemaining: '$' + unifiedCostRemaining.toFixed(2)
        },
        credits: raw.promptCredits,
        models: models
      };
      lastFetch = now;
      return cache;
    }
  } catch (err) {
    console.error('Antigravity adapter fetch error:', err.message);
  }

  return cache || {
    agent: 'antigravity',
    connected: false,
    tokens: { totalPool: 50000000, used: 49500000, remaining: 500000, formattedTotal: '50.0M', formattedUsed: '49.5M', formattedRemaining: '0.5M' },
    costUSD: { totalPool: 20.0, used: 19.80, remaining: 0.20, formattedUsed: '$19.80', formattedRemaining: '$0.20' },
    models: []
  };
}

function getLocalDateFromISO(isoStr) {
  if (!isoStr) return null;
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr).slice(0, 10);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAntigravityDaily(forceRefresh = false) {
  const now = Date.now();
  if (dailyCache && !forceRefresh && (now - dailyCacheTime < CACHE_TTL_MS)) {
    return dailyCache;
  }

  const brainPath = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
  if (!fs.existsSync(brainPath)) return [];

  const dirs = fs.readdirSync(brainPath);
  const byDate = {};

  for (const d of dirs) {
    const logFile = path.join(brainPath, d, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(logFile)) continue;

    let lastKnownDate = null;

    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const stepDate = getLocalDateFromISO(obj.created_at) || lastKnownDate;
          if (stepDate) lastKnownDate = stepDate;
          if (!stepDate) continue;

          if (!byDate[stepDate]) {
            byDate[stepDate] = { date: stepDate, steps: 0, chars: 0 };
          }
          byDate[stepDate].steps++;
          if (obj.content) byDate[stepDate].chars += String(obj.content).length;
          if (obj.thinking) byDate[stepDate].chars += String(obj.thinking).length;
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Calculate daily tokens & costs for Gemini 3.7 Flash
  const result = Object.values(byDate).map(item => {
    // 22,000 prompt tokens context per step + chars / 3.5
    const tokens = Math.round(item.chars / 3.5 + item.steps * 22000);
    const cacheTokens = Math.round(tokens * 0.75); // 75% average cache read
    const freshTokens = tokens - cacheTokens;
    // Gemini 3.7 Flash official rate: Fresh $0.15/1M, Cache Read $0.0375/1M
    const cost = +((freshTokens * 0.15 + cacheTokens * 0.0375) / 1e6).toFixed(4);

    return {
      date: item.date,
      agent: 'antigravity',
      company: 'Google (Gemini)',
      modelName: 'Gemini 3.7 Flash',
      totalTokens: tokens,
      cacheReadTokens: cacheTokens,
      inputTokens: tokens,
      outputTokens: Math.round(item.chars / 4),
      totalCost: cost,
      steps: item.steps
    };
  }).sort((a, b) => a.date.localeCompare(b.date));

  dailyCache = result;
  dailyCacheTime = now;
  return result;
}

module.exports = { getAntigravityStatus, getAntigravityDaily };
