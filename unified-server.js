const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const zcode = require('./zcode-adapter');
const antigravity = require('./antigravity-adapter');
const openclaw = require('./openclaw-adapter');
const projectAdapter = require('./project-adapter');
const codexImage = require('./codex-image-adapter');

const PORT = process.env.PORT || 4242;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Helper to get local date string YYYY-MM-DD
function getLocalDateStr(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Persistent and in-memory cache for Codex (ccusage)
const CACHE_DIR = path.join(__dirname, '.cache');
const CCUSAGE_CACHE_FILE = path.join(CACHE_DIR, 'ccusage-cache.json');
let codexCache = null;
let codexCacheTime = 0;
const CODEX_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
}

if (fs.existsSync(CCUSAGE_CACHE_FILE)) {
  try {
    codexCache = JSON.parse(fs.readFileSync(CCUSAGE_CACHE_FILE, 'utf8'));
    codexCacheTime = Date.now();
  } catch (e) {}
}

function getCodexData(force = false) {
  const now = Date.now();
  if (codexCache && !force && (now - codexCacheTime < CODEX_CACHE_TTL)) {
    return codexCache;
  }
  try {
    const cliPath = path.join(__dirname, 'node_modules', 'ccusage', 'src', 'cli.js');
    // First try 'codex daily --json' for exact native Codex SQLite tokens & models
    let res = spawnSync(process.execPath, [cliPath, 'codex', 'daily', '--json'], {
      timeout: 30000,
      env: { ...process.env, NO_COLOR: '1' }
    });
    // Fallback to general 'daily --json' if needed
    if (res.status !== 0 || !res.stdout || res.stdout.length === 0) {
      res = spawnSync(process.execPath, [cliPath, 'daily', '--json'], {
        timeout: 30000,
        env: { ...process.env, NO_COLOR: '1' }
      });
    }
    if (res.status === 0 && res.stdout) {
      codexCache = JSON.parse(res.stdout.toString().trim());
      codexCacheTime = now;
      try {
        fs.writeFile(CCUSAGE_CACHE_FILE, JSON.stringify(codexCache), () => {});
      } catch (e) {}
      return codexCache;
    }
  } catch (err) {
    console.error('Failed to get Codex data:', err.message);
  }
  return codexCache || { daily: [], totals: {} };
}

// Company Colors & Grouping
const COMPANY_CONFIG = {
  'OpenAI': { color: '#3b82f6', label: 'OpenAI (Codex / GPT)' },
  '智谱 AI (Z.ai)': { color: '#10b981', label: '智谱 AI (GLM-5.3)' },
  'Google (Gemini)': { color: '#06b6d4', label: 'Google DeepMind (Gemini)' },
  'DeepSeek': { color: '#f43f5e', label: 'DeepSeek' }
};

function getCompany(modelName, agent) {
  const m = (modelName || '').toLowerCase();
  if (m.includes('glm') || (agent === 'zcode' && !m.includes('gpt'))) {
    return '智谱 AI (Z.ai)';
  }
  if (m.includes('gemini') || agent === 'antigravity') {
    return 'Google (Gemini)';
  }
  if (m.includes('deepseek')) {
    return 'DeepSeek';
  }
  if (m.includes('gpt') || agent === 'codex') {
    return 'OpenAI';
  }
  return 'OpenAI';
}

function buildDashboardData(tier = 'standard', agentFilter = 'all') {
  const codexRaw = getCodexData();
  const zcodeDaily = zcode.getZCodeDaily(tier);
  const agyDaily = antigravity.getAntigravityDaily();

  // 1. Normalize Codex days (supports modelBreakdowns array, models object, and modelsUsed)
  const codexDaily = (codexRaw.daily || []).map(d => {
    const dayDate = d.date || d.period || '';
    const dayTotalCost = +(d.totalCost || d.costUSD || d.cost || 0);
    const dayTotalTokens = d.totalTokens || ((d.inputTokens || 0) + (d.outputTokens || 0) + (d.cacheReadTokens || 0));

    let breakdowns = [];

    // Format A: modelBreakdowns array (from ccusage daily --json)
    if (Array.isArray(d.modelBreakdowns) && d.modelBreakdowns.length > 0) {
      breakdowns = d.modelBreakdowns.map(b => ({
        modelName: b.modelName || 'gpt-5.6-sol',
        agent: 'codex',
        company: getCompany(b.modelName || 'gpt-5.6-sol', 'codex'),
        inputTokens: b.inputTokens || 0,
        outputTokens: b.outputTokens || 0,
        cacheReadTokens: b.cacheReadTokens || 0,
        totalTokens: b.totalTokens || ((b.inputTokens || 0) + (b.outputTokens || 0) + (b.cacheReadTokens || 0)),
        cost: +(b.cost || b.costUSD || 0)
      }));
    }
    // Format B: models map (from ccusage codex daily --json)
    else if (d.models && typeof d.models === 'object' && Object.keys(d.models).length > 0) {
      const modelKeys = Object.keys(d.models);
      const totalAllTokens = modelKeys.reduce((s, k) => s + (d.models[k].totalTokens || 0), 0) || 1;

      for (const [mName, mInfo] of Object.entries(d.models)) {
        const mTokens = mInfo.totalTokens || ((mInfo.inputTokens || 0) + (mInfo.outputTokens || 0) + (mInfo.cacheReadTokens || 0));
        let mCost = mInfo.costUSD !== undefined ? mInfo.costUSD : mInfo.cost;
        if (mCost === undefined || mCost === null) {
          mCost = modelKeys.length === 1 ? dayTotalCost : (dayTotalCost * (mTokens / totalAllTokens));
        }

        breakdowns.push({
          modelName: mName,
          agent: 'codex',
          company: getCompany(mName, 'codex'),
          inputTokens: mInfo.inputTokens || 0,
          outputTokens: mInfo.outputTokens || 0,
          cacheReadTokens: mInfo.cacheReadTokens || 0,
          totalTokens: mTokens,
          cost: +Number(mCost).toFixed(4)
        });
      }
    }
    // Format C: modelsUsed fallback list
    else if (Array.isArray(d.modelsUsed) && d.modelsUsed.length > 0) {
      const perModelCost = +(dayTotalCost / d.modelsUsed.length).toFixed(4);
      const perModelTokens = Math.round(dayTotalTokens / d.modelsUsed.length);
      for (const mName of d.modelsUsed) {
        breakdowns.push({
          modelName: mName,
          agent: 'codex',
          company: getCompany(mName, 'codex'),
          inputTokens: Math.round((d.inputTokens || 0) / d.modelsUsed.length),
          outputTokens: Math.round((d.outputTokens || 0) / d.modelsUsed.length),
          cacheReadTokens: Math.round((d.cacheReadTokens || 0) / d.modelsUsed.length),
          totalTokens: perModelTokens,
          cost: perModelCost
        });
      }
    }
    // Format D: Default fallback for any Codex day
    else if (dayTotalTokens > 0) {
      breakdowns.push({
        modelName: 'gpt-5.6-sol',
        agent: 'codex',
        company: 'OpenAI',
        inputTokens: d.inputTokens || 0,
        outputTokens: d.outputTokens || 0,
        cacheReadTokens: d.cacheReadTokens || 0,
        totalTokens: dayTotalTokens,
        cost: dayTotalCost
      });
    }

    return {
      date: dayDate,
      agent: 'codex',
      inputTokens: d.inputTokens || 0,
      outputTokens: d.outputTokens || 0,
      cacheReadTokens: d.cacheReadTokens || 0,
      totalTokens: dayTotalTokens,
      totalCost: dayTotalCost,
      modelsUsed: breakdowns.map(b => b.modelName),
      modelBreakdowns: breakdowns
    };
  });

  // Build merged calendar
  const dayMap = {};
  const todayStr = getLocalDateStr();

  function ensureDay(date) {
    if (!dayMap[date]) {
      dayMap[date] = {
        date,
        totalCost: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        byModel: {},
        byCompany: {
          'OpenAI': { cost: 0, tokens: 0, cacheTokens: 0, models: new Set() },
          '智谱 AI (Z.ai)': { cost: 0, tokens: 0, cacheTokens: 0, models: new Set() },
          'Google (Gemini)': { cost: 0, tokens: 0, cacheTokens: 0, models: new Set() },
          'DeepSeek': { cost: 0, tokens: 0, cacheTokens: 0, models: new Set() }
        },
        agents: new Set()
      };
    }
    return dayMap[date];
  }

  // Ensure current calendar day is always present
  ensureDay(todayStr);

  // 1. Process Codex
  if (agentFilter === 'all' || agentFilter === 'codex') {
    for (const d of codexDaily) {
      const day = ensureDay(d.date);
      day.totalCost += d.totalCost;
      day.totalTokens += d.totalTokens;
      day.cacheReadTokens += d.cacheReadTokens;
      day.inputTokens += d.inputTokens;
      day.outputTokens += d.outputTokens;
      day.agents.add('codex');

      for (const mb of d.modelBreakdowns) {
        const comp = mb.company || 'OpenAI';
        if (!day.byModel[mb.modelName]) {
          day.byModel[mb.modelName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: 'codex', company: comp };
        }
        day.byModel[mb.modelName].cost += mb.cost;
        day.byModel[mb.modelName].tokens += mb.totalTokens;
        day.byModel[mb.modelName].cacheTokens += mb.cacheReadTokens;

        day.byCompany[comp].cost += mb.cost;
        day.byCompany[comp].tokens += mb.totalTokens;
        day.byCompany[comp].cacheTokens += mb.cacheReadTokens;
        day.byCompany[comp].models.add(mb.modelName);
      }
    }
  }

  // 2. Process ZCode
  if (agentFilter === 'all' || agentFilter === 'zcode') {
    for (const z of zcodeDaily) {
      const day = ensureDay(z.date);
      day.totalCost += z.totalCost;
      day.totalTokens += z.totalTokens;
      day.cacheReadTokens += z.cacheReadTokens;
      day.inputTokens += z.inputTokens;
      day.outputTokens += z.outputTokens;
      day.agents.add('zcode');

      for (const mb of z.modelBreakdowns) {
        const comp = getCompany(mb.modelName, 'zcode');
        if (!day.byModel[mb.modelName]) {
          day.byModel[mb.modelName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: 'zcode', company: comp };
        }
        day.byModel[mb.modelName].cost += mb.cost;
        day.byModel[mb.modelName].tokens += mb.totalTokens;
        day.byModel[mb.modelName].cacheTokens += mb.cacheReadTokens;

        day.byCompany[comp].cost += mb.cost;
        day.byCompany[comp].tokens += mb.totalTokens;
        day.byCompany[comp].cacheTokens += mb.cacheReadTokens;
        day.byCompany[comp].models.add(mb.modelName);
      }
    }
  }

  // 3. Process Antigravity (Google Gemini)
  if (agentFilter === 'all' || agentFilter === 'antigravity') {
    for (const a of agyDaily) {
      const day = ensureDay(a.date);
      day.totalCost += a.totalCost;
      day.totalTokens += a.totalTokens;
      day.cacheReadTokens += a.cacheReadTokens;
      day.inputTokens += a.inputTokens;
      day.outputTokens += a.outputTokens;
      day.agents.add('antigravity');

      const modelName = a.modelName || 'Gemini 3.7 Flash';
      const comp = 'Google (Gemini)';
      if (!day.byModel[modelName]) {
        day.byModel[modelName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: 'antigravity', company: comp };
      }
      day.byModel[modelName].cost += a.totalCost;
      day.byModel[modelName].tokens += a.totalTokens;
      day.byModel[modelName].cacheTokens += a.cacheReadTokens;

      day.byCompany[comp].cost += a.totalCost;
      day.byCompany[comp].tokens += a.totalTokens;
      day.byCompany[comp].cacheTokens += a.cacheReadTokens;
      day.byCompany[comp].models.add(modelName);
    }
  }

  // 4. 解析 OpenClaw 与 Reasonix 的 DeepSeek 真实历史调用
  const openclawDaily = openclaw.getOpenClawAndReasonixDaily();
  for (const o of openclawDaily) {
    const day = ensureDay(o.date);
    day.totalCost += o.totalCost;
    day.totalTokens += o.totalTokens;
    day.cacheReadTokens += o.cacheReadTokens;
    day.inputTokens += o.inputTokens;
    day.outputTokens += o.outputTokens;
    day.agents.add('openclaw');

    const comp = 'DeepSeek';
    for (const mb of o.modelBreakdowns) {
      const mName = mb.modelName;
      if (!day.byModel[mName]) {
        day.byModel[mName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: mb.agent, company: comp };
      }
      day.byModel[mName].cost += mb.cost;
      day.byModel[mName].tokens += mb.totalTokens;
      day.byModel[mName].cacheTokens += mb.cacheReadTokens;

      day.byCompany[comp].cost += mb.cost;
      day.byCompany[comp].tokens += mb.totalTokens;
      day.byCompany[comp].cacheTokens += mb.cacheReadTokens;
      day.byCompany[comp].models.add(mName);
    }
  }

  // Sort dates ascending
  const sortedDates = Object.keys(dayMap).sort();
  const timeline = sortedDates.map(date => {
    const item = dayMap[date];
    const companyClean = {};
    for (const [cName, cData] of Object.entries(item.byCompany)) {
      companyClean[cName] = {
        cost: +cData.cost.toFixed(4),
        tokens: cData.tokens,
        cacheTokens: cData.cacheTokens,
        models: Array.from(cData.models)
      };
    }
    return {
      date,
      totalCost: +item.totalCost.toFixed(4),
      totalTokens: item.totalTokens,
      cacheReadTokens: item.cacheReadTokens,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      agents: Array.from(item.agents),
      byCompany: companyClean,
      byModel: item.byModel
    };
  });

  // Calculate Company Totals
  const companyStats = {};
  for (const [cName, cfg] of Object.entries(COMPANY_CONFIG)) {
    companyStats[cName] = {
      name: cName,
      label: cfg.label,
      color: cfg.color,
      totalCost: 0,
      totalTokens: 0,
      cacheTokens: 0,
      activeDays: 0
    };
  }

  for (const day of timeline) {
    for (const [cName, cData] of Object.entries(day.byCompany)) {
      if (cData.tokens > 0 || cData.cost > 0) {
        if (!companyStats[cName]) {
          companyStats[cName] = { name: cName, label: cName, color: '#94a3b8', totalCost: 0, totalTokens: 0, cacheTokens: 0, activeDays: 0 };
        }
        companyStats[cName].totalCost += cData.cost;
        companyStats[cName].totalTokens += cData.tokens;
        companyStats[cName].cacheTokens += cData.cacheTokens;
        companyStats[cName].activeDays += 1;
      }
    }
  }

  const companiesList = Object.values(companyStats)
    .filter(c => c.totalTokens > 0)
    .sort((a, b) => b.totalCost - a.totalCost)
    .map(c => ({
      ...c,
      totalCost: +c.totalCost.toFixed(2),
      formattedCost: '$' + c.totalCost.toFixed(2),
      formattedTokens: (c.totalTokens / 1e6).toFixed(1) + 'M'
    }));

  // Overall Totals
  const totalCost = timeline.reduce((s, d) => s + d.totalCost, 0);
  const totalTokens = timeline.reduce((s, d) => s + d.totalTokens, 0);
  const cacheReadTokens = timeline.reduce((s, d) => s + d.cacheReadTokens, 0);
  const cacheRate = totalTokens > 0 ? +((cacheReadTokens / totalTokens) * 100).toFixed(1) : 0;

  // Model Rankings
  const modelStats = {};
  for (const day of timeline) {
    for (const [mName, mData] of Object.entries(day.byModel)) {
      if (!modelStats[mName]) {
        modelStats[mName] = {
          modelName: mName,
          agent: mData.agent,
          company: mData.company,
          totalCost: 0,
          totalTokens: 0,
          cacheTokens: 0
        };
      }
      modelStats[mName].totalCost += mData.cost;
      modelStats[mName].totalTokens += mData.tokens;
      modelStats[mName].cacheTokens += mData.cacheTokens;
    }
  }

  const modelRanking = Object.values(modelStats)
    .sort((a, b) => b.totalCost - a.totalCost)
    .map(m => ({
      ...m,
      totalCost: +m.totalCost.toFixed(2),
      formattedCost: '$' + m.totalCost.toFixed(2),
      formattedTokens: (m.totalTokens / 1e6).toFixed(1) + 'M'
    }));

  // 按公司/产品系聚合模型（ChatGPT/OpenAI、智谱GLM、Google Gemini、DeepSeek）
  const familyDefs = [
    {
      id: 'openai',
      name: 'ChatGPT / OpenAI 全系模型',
      company: 'OpenAI',
      color: '#3b82f6',
      badge: 'OpenAI'
    },
    {
      id: 'zcode',
      name: '智谱 GLM 全系模型',
      company: '智谱 AI (Z.ai)',
      color: '#10b981',
      badge: '智谱'
    },
    {
      id: 'gemini',
      name: 'Google Gemini 全系模型',
      company: 'Google (Gemini)',
      color: '#06b6d4',
      badge: 'Google'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek 全系模型',
      company: 'DeepSeek',
      color: '#f43f5e',
      badge: 'DeepSeek'
    }
  ];

  const imageAnalysis = codexImage.getCodexImageAnalysis();

  const modelFamilies = familyDefs.map(fam => {
    let subModels = modelRanking.filter(m => m.company === fam.company);

    if (fam.id === 'openai' && imageAnalysis.totals.totalCount > 0) {
      subModels.push({
        modelName: `GPT-Image-2 (生图工具 · ${imageAnalysis.totals.totalCount}张原图)`,
        rawModel: 'GPT-Image-2',
        agent: 'codex',
        company: 'OpenAI',
        totalTokens: imageAnalysis.totals.totalTokens,
        formattedTokens: (imageAnalysis.totals.totalTokens / 1e6).toFixed(1) + 'M',
        cacheTokens: 0,
        totalCost: imageAnalysis.totals.totalCost,
        formattedCost: '$' + imageAnalysis.totals.totalCost.toFixed(2),
        isImageGen: true,
        imageCount: imageAnalysis.totals.totalCount
      });
    }

    const famCost = subModels.reduce((s, m) => s + m.totalCost, 0);
    const famTokens = subModels.reduce((s, m) => s + m.totalTokens, 0);
    const famCache = subModels.reduce((s, m) => s + m.cacheTokens, 0);

    return {
      id: fam.id,
      name: fam.name,
      company: fam.company,
      color: fam.color,
      badge: fam.badge,
      totalCost: +famCost.toFixed(2),
      formattedCost: '$' + famCost.toFixed(2),
      totalTokens: famTokens,
      formattedTokens: (famTokens / 1e6).toFixed(1) + 'M',
      cacheTokens: famCache,
      modelCount: subModels.length,
      subModels: subModels
    };
  }).filter(fam => fam.totalTokens > 0)
    .sort((a, b) => b.totalCost - a.totalCost);

  // Agent breakdowns
  const zcodeTotalTokens = zcodeDaily.reduce((s, d) => s + d.totalTokens, 0);
  const zcodeTotalCost = zcodeDaily.reduce((s, d) => s + d.totalCost, 0);
  const agyTotalTokens = agyDaily.reduce((s, d) => s + d.totalTokens, 0);
  const agyTotalCost = agyDaily.reduce((s, d) => s + d.totalCost, 0);

  // 5. Build Comprehensive Today Summary across ALL providers (unaffected by timeline agentFilter)
  const todayCodex = codexDaily.find(d => d.date === todayStr);
  const todayAgy = agyDaily.find(d => d.date === todayStr);
  const todayZcode = zcodeDaily.find(d => d.date === todayStr);
  const todayOpenclaw = openclawDaily.find(d => d.date === todayStr);
  const todayImgDaily = (imageAnalysis.daily || []).find(d => d.date === todayStr) || { 
    count: imageAnalysis.totals.todayCount || 0, 
    cost: imageAnalysis.totals.todayCost || 0, 
    tokens: imageAnalysis.totals.todayTokens || 0 
  };

  const todayByModel = {};
  let todayTotalCost = 0;
  let todayTotalTokens = 0;
  let todayCacheReadTokens = 0;
  let todayInputTokens = 0;
  let todayOutputTokens = 0;

  if (todayCodex) {
    todayTotalCost += todayCodex.totalCost;
    todayTotalTokens += todayCodex.totalTokens;
    todayCacheReadTokens += todayCodex.cacheReadTokens;
    todayInputTokens += todayCodex.inputTokens;
    todayOutputTokens += todayCodex.outputTokens;
    for (const mb of todayCodex.modelBreakdowns) {
      if (!todayByModel[mb.modelName]) {
        todayByModel[mb.modelName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: 'codex', company: mb.company || 'OpenAI' };
      }
      todayByModel[mb.modelName].cost += mb.cost;
      todayByModel[mb.modelName].tokens += mb.totalTokens;
      todayByModel[mb.modelName].cacheTokens += mb.cacheReadTokens;
    }
  }

  if (todayAgy) {
    todayTotalCost += todayAgy.totalCost;
    todayTotalTokens += todayAgy.totalTokens;
    todayCacheReadTokens += todayAgy.cacheReadTokens;
    todayInputTokens += todayAgy.inputTokens;
    todayOutputTokens += todayAgy.outputTokens;
    const mName = todayAgy.modelName || 'Gemini 3.7 Flash';
    if (!todayByModel[mName]) {
      todayByModel[mName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: 'antigravity', company: 'Google (Gemini)' };
    }
    todayByModel[mName].cost += todayAgy.totalCost;
    todayByModel[mName].tokens += todayAgy.totalTokens;
    todayByModel[mName].cacheTokens += todayAgy.cacheReadTokens;
  }

  if (todayZcode) {
    todayTotalCost += todayZcode.totalCost;
    todayTotalTokens += todayZcode.totalTokens;
    todayCacheReadTokens += todayZcode.cacheReadTokens;
    todayInputTokens += todayZcode.inputTokens;
    todayOutputTokens += todayZcode.outputTokens;
    for (const mb of todayZcode.modelBreakdowns) {
      const comp = getCompany(mb.modelName, 'zcode');
      if (!todayByModel[mb.modelName]) {
        todayByModel[mb.modelName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: 'zcode', company: comp };
      }
      todayByModel[mb.modelName].cost += mb.cost;
      todayByModel[mb.modelName].tokens += mb.totalTokens;
      todayByModel[mb.modelName].cacheTokens += mb.cacheReadTokens;
    }
  }

  if (todayOpenclaw) {
    todayTotalCost += todayOpenclaw.totalCost;
    todayTotalTokens += todayOpenclaw.totalTokens;
    todayCacheReadTokens += todayOpenclaw.cacheReadTokens;
    todayInputTokens += todayOpenclaw.inputTokens;
    todayOutputTokens += todayOpenclaw.outputTokens;
    for (const mb of todayOpenclaw.modelBreakdowns) {
      if (!todayByModel[mb.modelName]) {
        todayByModel[mb.modelName] = { cost: 0, tokens: 0, cacheTokens: 0, agent: mb.agent, company: 'DeepSeek' };
      }
      todayByModel[mb.modelName].cost += mb.cost;
      todayByModel[mb.modelName].tokens += mb.totalTokens;
      todayByModel[mb.modelName].cacheTokens += mb.cacheReadTokens;
    }
  }

  const todaySummary = {
    date: todayStr,
    totalCost: +todayTotalCost.toFixed(4),
    totalTokens: todayTotalTokens,
    cacheReadTokens: todayCacheReadTokens,
    inputTokens: todayInputTokens,
    outputTokens: todayOutputTokens,
    byModel: todayByModel,
    images: {
      count: todayImgDaily.count || 0,
      cost: todayImgDaily.cost || 0,
      tokens: todayImgDaily.tokens || 0
    }
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      today: todayStr,
      serverTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      agentFilter,
      pricingTier: tier,
      totalDays: timeline.length,
      earliestMilestone: '2026-05-22',
      earliestDescription: '2026-05-22 首次使用 OpenClaw 接入 DeepSeek API'
    },
    totals: {
      totalCostUSD: +(totalCost + imageAnalysis.totals.totalCost).toFixed(2),
      totalTokens: totalTokens + imageAnalysis.totals.totalTokens,
      cacheReadTokens,
      cacheRate,
      formattedCost: '$' + (totalCost + imageAnalysis.totals.totalCost).toFixed(2),
      formattedTokens: ((totalTokens + imageAnalysis.totals.totalTokens) / 1e6).toFixed(1) + 'M',
      formattedCacheTokens: (cacheReadTokens / 1e6).toFixed(1) + 'M'
    },
    agentBreakdown: {
      codex: {
        totalCost: +(codexDaily.reduce((s, d) => s + d.totalCost, 0) + imageAnalysis.totals.totalCost).toFixed(2),
        totalTokens: codexDaily.reduce((s, d) => s + d.totalTokens, 0) + imageAnalysis.totals.totalTokens,
        days: codexDaily.length
      },
      zcode: {
        totalCost: +zcodeTotalCost.toFixed(2),
        totalTokens: zcodeTotalTokens,
        days: zcodeDaily.length
      },
      antigravity: {
        totalCost: +agyTotalCost.toFixed(2),
        totalTokens: agyTotalTokens,
        days: agyDaily.length
      }
    },
    companies: companiesList,
    timeline,
    models: modelRanking,
    modelFamilies: modelFamilies,
    projects: projectAdapter.getProjectAttributionList(),
    imageAnalysis: imageAnalysis,
    todaySummary: todaySummary,
    zcodePricingInfo: {
      currentTier: tier,
      standardCostTotal: 32.16,
      flagshipCostTotal: 94.29
    }
  };
}

// Fast in-memory cache for dashboard responses (10 seconds)
const dashboardMemCache = {};
const dashboardMemTime = {};
const DASHBOARD_CACHE_TTL = 10 * 1000;

function getCachedDashboardData(tier, agent, force = false) {
  const key = `${tier}_${agent}`;
  const now = Date.now();
  if (!force && dashboardMemCache[key] && (now - (dashboardMemTime[key] || 0) < DASHBOARD_CACHE_TTL)) {
    return dashboardMemCache[key];
  }
  const data = buildDashboardData(tier, agent);
  dashboardMemCache[key] = data;
  dashboardMemTime[key] = now;
  return data;
}

// Security: allowed image base directories for /api/codex-image
const customImageDirs = process.env.CODEX_IMAGE_DIRS ? process.env.CODEX_IMAGE_DIRS.split(path.delimiter).map(d => path.resolve(d)) : [];
const ALLOWED_IMAGE_DIRS = [
  ...customImageDirs,
  path.resolve(os.homedir(), '.codex', 'generated_images'),
  path.resolve('D:\\codex\\generated_images')
];

// HTTP Server
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 1: Codex Generated Image Server (Protected against Path Traversal)
  if (pathname === '/api/codex-image') {
    const rawPath = urlObj.searchParams.get('path');
    if (!rawPath) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing path query parameter' }));
      return;
    }

    try {
      const resolvedPath = path.resolve(rawPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const isAllowedExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);

      // Verify the file is in an allowed image directory or matches valid generated_images path
      const isInsideAllowedDir = ALLOWED_IMAGE_DIRS.some(dir => resolvedPath.startsWith(dir)) || 
        resolvedPath.toLowerCase().includes('generated_images');

      if (!isAllowedExt || !isInsideAllowedDir || !fs.existsSync(resolvedPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Image not found or access denied' }));
        return;
      }

      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not a valid file' }));
        return;
      }

      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { 
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400, immutable'
      });
      fs.createReadStream(resolvedPath).pipe(res);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Error reading image', message: err.message }));
      return;
    }
  }

  // API 2: Project Attribution List
  if (pathname === '/api/projects') {
    try {
      const pList = projectAdapter.getProjectAttributionList();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ projects: pList, totalCount: pList.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to retrieve project attribution', message: err.message }));
    }
    return;
  }

  // API 3: Comprehensive Dashboard Data
  if (pathname === '/api/dashboard') {
    try {
      let tier = (urlObj.searchParams.get('tier') || 'standard').toLowerCase();
      if (!['standard', 'flagship'].includes(tier)) tier = 'standard';

      let agent = (urlObj.searchParams.get('agent') || 'all').toLowerCase();
      if (!['all', 'codex', 'zcode', 'antigravity', 'openclaw'].includes(agent)) agent = 'all';

      const data = getCachedDashboardData(tier, agent);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to load dashboard data', message: err.message }));
    }
    return;
  }

  // API 4: Refresh and Invalidate Caches
  if (pathname === '/api/refresh') {
    try {
      // Bust dashboard cache
      for (const k of Object.keys(dashboardMemCache)) delete dashboardMemCache[k];
      getCodexData(true);
      antigravity.getAntigravityDaily(true);
      codexImage.getCodexImageAnalysis(true);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, timestamp: Date.now() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Failed to refresh data', message: err.message }));
    }
    return;
  }

  // Static File Serving (with Path Traversal protection)
  const normalizedPath = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, normalizedPath);
  const resolvedFilePath = path.resolve(filePath);

  // Security: prevent escaping PUBLIC_DIR
  if (!resolvedFilePath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden: Access outside public directory is denied');
    return;
  }

  let targetFile = resolvedFilePath;
  if (!fs.existsSync(targetFile)) {
    // SPA fallback: default to index.html for frontend routing
    targetFile = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(targetFile).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(targetFile, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Unified Agentic Dashboard running at http://localhost:${PORT}`);
  });
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

module.exports = {
  server,
  buildDashboardData,
  getCachedDashboardData,
  getCodexData,
  PORT,
  PUBLIC_DIR
};

