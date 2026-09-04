const { DatabaseSync } = require('node:sqlite');
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * 智谱 AI / Z.ai 官方客观定价字典 (美元 USD / 1M Tokens)
 * 1. 标准目录价 (Standard Catalog Price):
 *    - GLM-5.3-Flash: 输入 $0.15 / 1M, 输出 $0.50 / 1M, 缓存读取 $0.03 / 1M
 * 2. 旗舰模型定价 (Flagship Model Price - 如 GLM-5.3 旗舰版/GLM-4-Plus):
 *    - GLM-5.3: 输入 $1.00 / 1M, 输出 $3.00 / 1M, 缓存读取 $0.20 / 1M
 */
const PRICING_TIERS = {
  standard: {
    'GLM-5.3-Flash': { in: 0.15, out: 0.50, cache: 0.03 },
    'GLM-5.3': { in: 1.00, out: 3.00, cache: 0.20 },
    'GLM-5.2': { in: 0.80, out: 2.50, cache: 0.15 },
    'gpt-5.5': { in: 2.50, out: 10.00, cache: 1.25 },
    'gpt-5.6-sol': { in: 1.75, out: 14.00, cache: 0.53375 },
    'gpt-5.6-terra': { in: 0.75, out: 6.00, cache: 0.375 },
  },
  flagship: {
    // 旗舰折算模式：将 GLM 统一按智谱旗舰代码智能体标准定价核算
    'GLM-5.3-Flash': { in: 1.00, out: 3.00, cache: 0.20 },
    'GLM-5.3': { in: 1.00, out: 3.00, cache: 0.20 },
    'GLM-5.2': { in: 1.00, out: 3.00, cache: 0.20 },
    'gpt-5.5': { in: 2.50, out: 10.00, cache: 1.25 },
    'gpt-5.6-sol': { in: 1.75, out: 14.00, cache: 0.53375 },
    'gpt-5.6-terra': { in: 0.75, out: 6.00, cache: 0.375 },
  }
};

function calculateCost(modelId, inTok, outTok, cacheTok, tier = 'standard') {
  const table = PRICING_TIERS[tier] || PRICING_TIERS.standard;
  const p = table[modelId] || { in: 0.5, out: 1.5, cache: 0.1 };
  const freshIn = Math.max(0, (inTok || 0) - (cacheTok || 0));
  return (freshIn * p.in + (cacheTok || 0) * p.cache + (outTok || 0) * p.out) / 1e6;
}

function getZCodeDaily(tier = 'standard') {
  const dbPath = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
  if (!fs.existsSync(dbPath)) return [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`
      SELECT 
        date(started_at / 1000, 'unixepoch') as day,
        model_id,
        SUM(input_tokens) as in_tok,
        SUM(output_tokens) as out_tok,
        SUM(cache_read_input_tokens) as cache_tok,
        SUM(computed_total_tokens) as total_tok
      FROM model_usage
      GROUP BY day, model_id
      ORDER BY day ASC
    `).all();

    const byDay = {};
    for (const r of rows) {
      const day = r.day;
      if (!byDay[day]) {
        byDay[day] = {
          date: day,
          period: day,
          agent: 'zcode',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          modelsUsed: [],
          modelBreakdowns: []
        };
      }
      const cost = calculateCost(r.model_id, Number(r.in_tok), Number(r.out_tok), Number(r.cache_tok), tier);
      byDay[day].inputTokens += Number(r.in_tok) || 0;
      byDay[day].outputTokens += Number(r.out_tok) || 0;
      byDay[day].cacheReadTokens += Number(r.cache_tok) || 0;
      byDay[day].totalTokens += Number(r.total_tok) || 0;
      byDay[day].totalCost += cost;
      
      const displayName = `${r.model_id} (ZCode)`;
      byDay[day].modelsUsed.push(displayName);
      byDay[day].modelBreakdowns.push({
        modelName: displayName,
        rawModel: r.model_id,
        agent: 'zcode',
        inputTokens: Number(r.in_tok) || 0,
        outputTokens: Number(r.out_tok) || 0,
        cacheReadTokens: Number(r.cache_tok) || 0,
        cacheCreationTokens: 0,
        totalTokens: Number(r.total_tok) || 0,
        cost: cost
      });
    }

    // 2. 解析 2026 年 6 月 14 ~ 24 日 ZCode 刚发布公测免费赠送额度时期的历史调用 (存储于 part 表)
    const earlyParts = db.prepare(`
      SELECT time_created, data 
      FROM part 
      WHERE time_created < 1785000000000 AND data LIKE '%"type":"step-finish"%'
      ORDER BY time_created ASC
    `).all();

    for (const r of earlyParts) {
      try {
        const obj = JSON.parse(r.data);
        if (obj.tokens) {
          const tot = obj.tokens.total || 0;
          const inp = obj.tokens.input || 0;
          const out = obj.tokens.output || 0;
          const cache = (obj.tokens.cache && obj.tokens.cache.read) || 0;
          const day = new Date(r.time_created).toISOString().slice(0, 10);

          if (!byDay[day]) {
            byDay[day] = {
              date: day,
              period: day,
              agent: 'zcode',
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              totalTokens: 0,
              totalCost: 0,
              modelsUsed: [],
              modelBreakdowns: []
            };
          }

          const modelId = 'GLM-5.2';
          const displayName = 'GLM-5.2 (ZCode早期公测)';
          const cost = calculateCost(modelId, inp, out, cache, tier);

          byDay[day].inputTokens += inp;
          byDay[day].outputTokens += out;
          byDay[day].cacheReadTokens += cache;
          byDay[day].totalTokens += tot;
          byDay[day].totalCost += cost;

          if (!byDay[day].modelsUsed.includes(displayName)) {
            byDay[day].modelsUsed.push(displayName);
          }

          let mb = byDay[day].modelBreakdowns.find(x => x.modelName === displayName);
          if (!mb) {
            mb = {
              modelName: displayName,
              rawModel: modelId,
              agent: 'zcode',
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              totalTokens: 0,
              cost: 0
            };
            byDay[day].modelBreakdowns.push(mb);
          }
          mb.inputTokens += inp;
          mb.outputTokens += out;
          mb.cacheReadTokens += cache;
          mb.totalTokens += tot;
          mb.cost += cost;
        }
      } catch (e) {}
    }

    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error('Failed to query ZCode sqlite:', err);
    return [];
  }
}

function getZCodeMonthly(tier = 'standard') {
  const daily = getZCodeDaily(tier);
  const byMonth = {};
  for (const d of daily) {
    const m = d.date.slice(0, 7);
    if (!byMonth[m]) {
      byMonth[m] = {
        month: m,
        period: m,
        agent: 'zcode',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        modelsUsed: [],
        modelBreakdowns: []
      };
    }
    byMonth[m].inputTokens += d.inputTokens;
    byMonth[m].outputTokens += d.outputTokens;
    byMonth[m].cacheReadTokens += d.cacheReadTokens;
    byMonth[m].totalTokens += d.totalTokens;
    byMonth[m].totalCost += d.totalCost;
    for (const model of d.modelsUsed) {
      if (!byMonth[m].modelsUsed.includes(model)) byMonth[m].modelsUsed.push(model);
    }
    for (const b of d.modelBreakdowns) {
      const existing = byMonth[m].modelBreakdowns.find(x => x.modelName === b.modelName);
      if (existing) {
        existing.inputTokens += b.inputTokens;
        existing.outputTokens += b.outputTokens;
        existing.cacheReadTokens += b.cacheReadTokens;
        existing.totalTokens += b.totalTokens;
        existing.cost += b.cost;
      } else {
        byMonth[m].modelBreakdowns.push({ ...b });
      }
    }
  }
  return Object.values(byMonth);
}

module.exports = { getZCodeDaily, getZCodeMonthly, PRICING_TIERS, calculateCost };
