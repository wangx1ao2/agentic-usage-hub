const fs = require('fs');
const path = require('path');
const os = require('os');

function getOpenClawAndReasonixDaily() {
  const dailyMap = {};

  function addUsage(dateStr, tokens, inputTokens, outputTokens, cacheReadTokens, cost, modelName, agentSource) {
    if (!dailyMap[dateStr]) {
      dailyMap[dateStr] = {
        date: dateStr,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalCost: 0,
        modelsUsed: new Set(),
        modelBreakdowns: {}
      };
    }
    const d = dailyMap[dateStr];
    d.totalTokens += tokens;
    d.inputTokens += inputTokens;
    d.outputTokens += outputTokens;
    d.cacheReadTokens += cacheReadTokens;
    d.totalCost += cost;
    d.modelsUsed.add(modelName);

    if (!d.modelBreakdowns[modelName]) {
      d.modelBreakdowns[modelName] = {
        modelName,
        agent: agentSource,
        company: 'DeepSeek',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        cost: 0
      };
    }
    const mb = d.modelBreakdowns[modelName];
    mb.inputTokens += inputTokens;
    mb.outputTokens += outputTokens;
    mb.cacheReadTokens += cacheReadTokens;
    mb.totalTokens += tokens;
    mb.cost += cost;
  }

  // 1. Parse OpenClaw trajectories
  const openclawCandidates = [
    process.env.OPENCLAW_SESSIONS_DIR,
    'D:\\Openclaw\\.openclaw\\agents\\main\\sessions',
    path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions')
  ].filter(Boolean);
  const openclawDir = openclawCandidates.find(d => fs.existsSync(d));

  if (openclawDir && fs.existsSync(openclawDir)) {
    try {
      const files = fs.readdirSync(openclawDir).filter(f => f.endsWith('.trajectory.jsonl'));
      for (const f of files) {
        const fullPath = path.join(openclawDir, f);
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            let candidates = [];
            if (obj.data && typeof obj.data === 'object') {
              for (const k of ['trajectory', 'messages', 'items']) {
                if (Array.isArray(obj.data[k])) candidates.push(...obj.data[k]);
              }
            }
            candidates.push(obj);

            for (const item of candidates) {
              if (!item || typeof item !== 'object') continue;
              const usage = item.usage;
              if (usage && typeof usage === 'object') {
                const inp = usage.input || usage.prompt_tokens || 0;
                const out = usage.output || usage.completion_tokens || 0;
                const cache = usage.cacheRead || usage.cache_hit_tokens || usage.cache_read_tokens || 0;
                const tot = usage.totalTokens || (inp + out + cache);

                let cost = 0;
                if (usage.cost && typeof usage.cost === 'object') {
                  cost = Number(usage.cost.total || 0);
                } else if (typeof usage.cost === 'number') {
                  cost = usage.cost;
                }

                const ts = item.timestamp || obj.ts || item.ts;
                if (ts && tot > 0) {
                  const dObj = new Date(ts < 1e11 ? ts * 1000 : ts);
                  const dateStr = dObj.toISOString().slice(0, 10);
                  const model = item.model || obj.modelId || 'deepseek-v4-flash';
                  const modelLabel = `${model} (OpenClaw)`;
                  addUsage(dateStr, tot, inp, out, cache, cost, modelLabel, 'openclaw');
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('Error reading OpenClaw sessions:', e.message);
    }
  }

  // 2. Parse Reasonix usage.jsonl
  const reasonixUsage = process.env.REASONIX_USAGE_FILE || path.join(os.homedir(), '.reasonix', 'usage.jsonl');
  if (fs.existsSync(reasonixUsage)) {
    try {
      const content = fs.readFileSync(reasonixUsage, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          const ts = item.ts;
          const tot = (item.promptTokens || 0) + (item.completionTokens || 0);
          const inp = item.cacheMissTokens || item.promptTokens || 0;
          const out = item.completionTokens || 0;
          const cache = item.cacheHitTokens || 0;
          const cost = item.costUsd || 0;
          const model = item.model || 'deepseek-v4-flash';
          const modelLabel = `${model} (Reasonix)`;
          if (ts && tot > 0) {
            const dateStr = new Date(ts < 1e11 ? ts * 1000 : ts).toISOString().slice(0, 10);
            addUsage(dateStr, tot, inp, out, cache, cost, modelLabel, 'reasonix');
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error('Error reading Reasonix usage:', e.message);
    }
  }

  // Format into daily list
  const results = Object.values(dailyMap).map(d => ({
    date: d.date,
    totalTokens: d.totalTokens,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    cacheReadTokens: d.cacheReadTokens,
    totalCost: +d.totalCost.toFixed(4),
    modelsUsed: Array.from(d.modelsUsed),
    modelBreakdowns: Object.values(d.modelBreakdowns).map(mb => ({
      ...mb,
      cost: +mb.cost.toFixed(4)
    }))
  }));

  return results.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  getOpenClawAndReasonixDaily
};
