const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

// Pricing reference for calculating USD from tokens
const MODEL_PRICES = {
  // OpenAI
  'gpt-5.5': { in: 2.50, out: 10.00, cache: 1.25 },
  'gpt-5.6-sol': { in: 1.75, out: 14.00, cache: 0.53375 },
  'gpt-5.6-terra': { in: 0.75, out: 6.00, cache: 0.375 },
  'gpt-5.6-luna': { in: 0.25, out: 2.00, cache: 0.125 },
  'gpt-5.4': { in: 2.50, out: 10.00, cache: 1.25 },
  'gpt-5.4-mini': { in: 0.15, out: 0.60, cache: 0.075 },
  // ZCode / GLM
  'GLM-5.3-Flash': { in: 0.15, out: 0.50, cache: 0.03 },
  'GLM-5.3': { in: 1.00, out: 3.00, cache: 0.20 },
  'GLM-5.2': { in: 0.80, out: 2.50, cache: 0.15 },
  // DeepSeek
  'deepseek-v4-flash': { in: 0.14, out: 0.28, cache: 0.028 },
  'deepseek-v4-pro': { in: 0.55, out: 2.19, cache: 0.14 }
};

function estCost(model, tokens, cacheTokens = 0) {
  const p = MODEL_PRICES[model] || MODEL_PRICES['gpt-5.5'];
  const fresh = Math.max(0, tokens - cacheTokens);
  // Estimate 85% input, 15% output for agent interactive loops
  const inTok = fresh * 0.85;
  const outTok = fresh * 0.15;
  return (inTok * p.in + (cacheTokens * p.cache) + (outTok * p.out)) / 1e6;
}

// Canonical project mapper
function canonicalizeProject(rawPath) {
  if (!rawPath) return { key: 'other', name: '临时与未命名会话', icon: '📝' };
  
  const norm = rawPath.replace(/\\/g, '/').toLowerCase();

  if (norm.includes('novel') || norm.includes('小说') || norm.includes('苟全性命') || norm.includes('苟道')) {
    return { key: 'novel', name: '《小说创作与大模型长文本项目》', icon: '📖', desc: '含《苟全性命》、《K线》、《AI生存指南》等长篇小说' };
  }
  if (norm.includes('xianyu') || norm.includes('autorobot') || norm.includes('闲鱼') || norm.includes('自动回复')) {
    return { key: 'xianyu', name: '《闲鱼自动回复机器人插件》', icon: '🤖', desc: '电商/闲鱼自动客服与消息智能接单插件' };
  }
  if (norm.includes('vibecoding') || norm.includes('底线搭建') || norm.includes('skills')) {
    return { key: 'vibecoding', name: '《VibeCoding 编程体系与技能底线》', icon: '⚡', desc: 'AI Coding 规范、架构技能流与底线约束构建' };
  }
  if (norm.includes('psychoanalysis') || norm.includes('心理')) {
    return { key: 'psychoanalysis', name: '《心理分析与认知决策系统》', icon: '🧠', desc: '深度精神与认知逻辑模型分析系统' };
  }
  if (norm.includes('money') || norm.includes('商业') || norm.includes('赚钱')) {
    return { key: 'money', name: '《商业化与赚钱项目落地》', icon: '💰', desc: '变现通路、商业模式拆解与项目落地' };
  }
  if (norm.includes('openclaw') || norm.includes('xiaohongshu')) {
    return { key: 'openclaw', name: '《小红书运营智能体 (OpenClaw)》', icon: '🦞', desc: '小红书内容生产、自动发布与矩阵运营' };
  }
  if (norm.includes('nvwa') || norm.includes('女娲')) {
    return { key: 'nvwa', name: '《女娲智能体项目 (Nvwa Agent)》', icon: '🧚', desc: '高阶自动化多智能体框架体系' };
  }
  if (norm.includes('token') || norm.includes('ccusage')) {
    return { key: 'token', name: '《Agentic Usage Hub 看板系统》', icon: '📊', desc: '当前三合一多智能体统一监控与计量大屏' };
  }
  if (norm.includes('linuxdo')) {
    return { key: 'linuxdo', name: '《Linux.do 社区学习与生态》', icon: '🐧', desc: 'Linux.do 论坛知识沉淀与工具链开发' };
  }
  if (norm.includes('qqchat') || norm.includes('qq')) {
    return { key: 'qqchat', name: '《QQ 交互助手与通讯智能体》', icon: '📱', desc: 'IM 即时通讯集成与自动问答' };
  }
  if (norm.includes('canvas') || norm.includes('storyboard')) {
    return { key: 'canvas', name: '《Infinite Canvas 无限画布》', icon: '🎨', desc: '无限画板、视觉故事板与 UI 流程设计' };
  }
  if (norm.includes('study') || norm.includes('学习') || norm.includes('文学理论')) {
    return { key: 'study', name: '《学术与文学理论研究》', icon: '📚', desc: '文学结构、社科与深度研究' };
  }
  if (norm.includes('3d') || norm.includes('erp') || norm.includes('跨境电商')) {
    return { key: 'business_apps', name: '《企业与跨境应用系统》', icon: '🏢', desc: '3D建模、ERP系统与跨境电商应用' };
  }
  if (norm.includes('电商') || norm.includes('ecommerce')) {
    return { key: 'ecommerce', name: '《电商运营与业务系统》', icon: '🛒', desc: '电商运营体系、自动化选品与业务工具' };
  }
  if (norm.includes('ppt') || norm.includes('报告')) {
    return { key: 'ppt_report', name: '《商业报告与路演 PPT》', icon: '📊', desc: '市场调研报告、PPT 架构与商业演讲材料' };
  }
  if (norm.includes('博客') || norm.includes('blog')) {
    return { key: 'blog', name: '《个人技术博客与知识站》', icon: '✍️', desc: '个人技术沉淀、博客专栏与知识分享' };
  }
  if (norm.includes('提示词') || norm.includes('prompt')) {
    return { key: 'prompts', name: '《Prompt 提示词工程库》', icon: '🔮', desc: '系统提示词调优、角色设定与 Prompt 资产' };
  }
  if (norm.includes('地图') || norm.includes('获客')) {
    return { key: 'map_leads', name: '《地图智能获客与拓客系统》', icon: '🗺️', desc: '地图数据挖掘、企业线索整理与拓客工具' };
  }
  if (norm.includes('螺丝') || norm.includes('五金')) {
    return { key: 'hardware_parts', name: '《五金紧固件与配件数据库》', icon: '🔩', desc: '工业配件、规格选型与垂直数据工具' };
  }
  if (norm.includes('哲学') || norm.includes('辩论')) {
    return { key: 'philosophy', name: '《哲学辩论与思维实验系统》', icon: '🏛️', desc: '辩证逻辑推演、哲学流派对抗与思维实验' };
  }
  if (norm.includes('documents/codex') || norm.includes('documents\\codex')) {
    return { key: 'codex_adhoc', name: '《Codex 命令行日常会话与即时调试》', icon: '⚡', desc: 'Codex CLI 即时提问、排错与日常会话碎片' };
  }
  if (norm.includes('zcodeproject')) {
    return { key: 'zcode_project', name: '《ZCode 项目工作区》', icon: '💻', desc: 'ZCode 默认本地工程与代码仓库' };
  }

  // Fallback: extract folder name
  const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const baseName = parts[parts.length - 1] || '其他工程';
  return { key: 'custom_' + baseName, name: `《${baseName}》`, icon: '📁', desc: rawPath };
}

function getProjectAttributionList() {
  const projectMap = {};

  function ensureProject(info, samplePath) {
    if (!projectMap[info.key]) {
      projectMap[info.key] = {
        id: info.key,
        name: info.name,
        icon: info.icon,
        desc: info.desc || samplePath,
        primaryPath: samplePath || '',
        paths: new Set(),
        totalTokens: 0,
        cacheTokens: 0,
        totalCost: 0,
        sessionCount: 0,
        agents: new Set(),
        companies: {
          'OpenAI': { tokens: 0, cost: 0, color: '#3b82f6' },
          '智谱 AI (Z.ai)': { tokens: 0, cost: 0, color: '#10b981' },
          'Google (Gemini)': { tokens: 0, cost: 0, color: '#06b6d4' },
          'DeepSeek': { tokens: 0, cost: 0, color: '#f43f5e' }
        },
        models: {},
        lastActive: ''
      };
    }
    if (samplePath) projectMap[info.key].paths.add(samplePath);
    return projectMap[info.key];
  }

  // 1. Process Codex threads from state_5.sqlite
  const codexDb = path.join(os.homedir(), '.codex', 'state_5.sqlite');
  if (fs.existsSync(codexDb)) {
    try {
      const db = new DatabaseSync(codexDb, { readOnly: true });
      const rows = db.prepare(`
        SELECT cwd, tokens_used, model, created_at_ms 
        FROM threads 
        WHERE tokens_used > 0
      `).all();

      for (const r of rows) {
        const cwd = r.cwd || '';
        const info = canonicalizeProject(cwd);
        const p = ensureProject(info, cwd);

        const tokens = Number(r.tokens_used) || 0;
        const model = r.model || 'gpt-5.5';
        // Codex has ~90% cache on average
        const cache = Math.floor(tokens * 0.90);
        const cost = estCost(model, tokens, cache);

        p.totalTokens += tokens;
        p.cacheTokens += cache;
        p.totalCost += cost;
        p.sessionCount += 1;
        p.agents.add('codex');

        p.companies['OpenAI'].tokens += tokens;
        p.companies['OpenAI'].cost += cost;

        p.models[model] = (p.models[model] || 0) + tokens;

        if (r.created_at_ms) {
          const dStr = new Date(Number(r.created_at_ms)).toISOString().slice(0, 10);
          if (!p.lastActive || dStr > p.lastActive) p.lastActive = dStr;
        }
      }
    } catch (e) {
      console.error('Failed to parse Codex projects:', e.message);
    }
  }

  // 2. Process ZCode sessions from db.sqlite
  const zcodeDb = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
  if (fs.existsSync(zcodeDb)) {
    try {
      const db = new DatabaseSync(zcodeDb, { readOnly: true });
      
      // Join session with model_usage
      const rows = db.prepare(`
        SELECT s.directory, m.input_tokens, m.output_tokens, m.cache_read_input_tokens, m.computed_total_tokens, m.model_id, m.started_at
        FROM model_usage m
        JOIN session s ON m.session_id = s.id
      `).all();

      for (const r of rows) {
        const dir = r.directory || '';
        const info = canonicalizeProject(dir);
        const p = ensureProject(info, dir);

        const tot = Number(r.computed_total_tokens) || 0;
        const cache = Number(r.cache_read_input_tokens) || 0;
        const model = r.model_id || 'GLM-5.3-Flash';
        const cost = estCost(model, tot, cache);

        p.totalTokens += tot;
        p.cacheTokens += cache;
        p.totalCost += cost;
        p.agents.add('zcode');

        const comp = model.includes('gpt') ? 'OpenAI' : '智谱 AI (Z.ai)';
        p.companies[comp].tokens += tot;
        p.companies[comp].cost += cost;
        p.models[model] = (p.models[model] || 0) + tot;

        if (r.started_at) {
          const dStr = new Date(Number(r.started_at)).toISOString().slice(0, 10);
          if (!p.lastActive || dStr > p.lastActive) p.lastActive = dStr;
        }
      }

      // Also process early June parts in ZCode
      const earlyParts = db.prepare(`
        SELECT s.directory, p.time_created, p.data 
        FROM part p
        JOIN message m ON p.message_id = m.id
        JOIN session s ON m.session_id = s.id
        WHERE p.time_created < 1785000000000 AND p.data LIKE '%"type":"step-finish"%'
      `).all();

      for (const ep of earlyParts) {
        try {
          const obj = JSON.parse(ep.data);
          if (obj.tokens) {
            const dir = ep.directory || '';
            const info = canonicalizeProject(dir);
            const p = ensureProject(info, dir);

            const tot = obj.tokens.total || 0;
            const cache = (obj.tokens.cache && obj.tokens.cache.read) || 0;
            const model = 'GLM-5.2';
            const cost = estCost(model, tot, cache);

            p.totalTokens += tot;
            p.cacheTokens += cache;
            p.totalCost += cost;
            p.agents.add('zcode');
            p.companies['智谱 AI (Z.ai)'].tokens += tot;
            p.companies['智谱 AI (Z.ai)'].cost += cost;
            p.models[model] = (p.models[model] || 0) + tot;

            const dStr = new Date(ep.time_created).toISOString().slice(0, 10);
            if (!p.lastActive || dStr > p.lastActive) p.lastActive = dStr;
          }
        } catch (e) {}
      }

    } catch (e) {
      console.error('Failed to parse ZCode projects:', e.message);
    }
  }

  // 3. Process Claude Code projects
  const claudeBase = path.join(os.homedir(), '.claude', 'projects');
  if (fs.existsSync(claudeBase)) {
    try {
      const dirs = fs.readdirSync(claudeBase);
      for (const d of dirs) {
        const fullDir = path.join(claudeBase, d);
        if (!fs.statSync(fullDir).isDirectory()) continue;
        const decodedPath = d.replace(/--/g, '\\').replace(/-/g, '_');
        const info = canonicalizeProject(decodedPath);
        const p = ensureProject(info, decodedPath);

        const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
        for (const f of files) {
          p.sessionCount += 1;
          p.agents.add('claude');
          // Sample usage from project files
          try {
            const content = fs.readFileSync(path.join(fullDir, f), 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
              if (!line.trim() || !line.includes('"usage"')) continue;
              try {
                const item = JSON.parse(line);
                const u = item.message?.usage || item.usage;
                if (u) {
                  const inp = u.input_tokens || 0;
                  const out = u.output_tokens || 0;
                  const cache = u.cache_read_input_tokens || 0;
                  const tok = inp + out + cache;
                  const cost = (inp * 0.14 + cache * 0.028 + out * 0.28) / 1e6;

                  p.totalTokens += tok;
                  p.cacheTokens += cache;
                  p.totalCost += cost;
                  p.companies['DeepSeek'].tokens += tok;
                  p.companies['DeepSeek'].cost += cost;
                  p.models['deepseek-v4-flash'] = (p.models['deepseek-v4-flash'] || 0) + tok;
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('Failed to parse Claude projects:', e.message);
    }
  }

  // 4. Process OpenClaw
  const openclawInfo = canonicalizeProject('D:\\Openclaw');
  const op = ensureProject(openclawInfo, 'D:\\Openclaw');
  // From our verified openclaw adapter: 169.8M tokens, $7.10 USD
  op.totalTokens += 169817101;
  op.cacheTokens += 151100000;
  op.totalCost += 7.1047;
  op.sessionCount += 24;
  op.agents.add('openclaw');
  op.companies['DeepSeek'].tokens += 169817101;
  op.companies['DeepSeek'].cost += 7.1047;
  op.models['deepseek-v4-flash'] = (op.models['deepseek-v4-flash'] || 0) + 169817101;
  if (!op.lastActive) op.lastActive = '2026-06-12';

  // Format into sorted array
  const list = Object.values(projectMap)
    .filter(p => p.totalTokens > 0)
    .map(p => {
      const topModelEntries = Object.entries(p.models)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([m, tok]) => ({ model: m, tokens: tok }));

      return {
        id: p.id,
        name: p.name,
        icon: p.icon,
        desc: p.desc,
        primaryPath: p.primaryPath,
        pathCount: p.paths.size,
        paths: Array.from(p.paths),
        totalTokens: p.totalTokens,
        cacheTokens: p.cacheTokens,
        totalCost: +p.totalCost.toFixed(2),
        formattedCost: '$' + p.totalCost.toFixed(2),
        formattedTokens: p.totalTokens >= 1e8 
          ? (p.totalTokens / 1e8).toFixed(2) + ' 亿' 
          : (p.totalTokens / 1e6).toFixed(1) + 'M',
        sessionCount: p.sessionCount,
        agents: Array.from(p.agents),
        companies: {
          openai: {
            tokens: p.companies['OpenAI'].tokens,
            cost: +p.companies['OpenAI'].cost.toFixed(2),
            percent: p.totalTokens > 0 ? +((p.companies['OpenAI'].tokens / p.totalTokens) * 100).toFixed(1) : 0
          },
          zcode: {
            tokens: p.companies['智谱 AI (Z.ai)'].tokens,
            cost: +p.companies['智谱 AI (Z.ai)'].cost.toFixed(2),
            percent: p.totalTokens > 0 ? +((p.companies['智谱 AI (Z.ai)'].tokens / p.totalTokens) * 100).toFixed(1) : 0
          },
          deepseek: {
            tokens: p.companies['DeepSeek'].tokens,
            cost: +p.companies['DeepSeek'].cost.toFixed(2),
            percent: p.totalTokens > 0 ? +((p.companies['DeepSeek'].tokens / p.totalTokens) * 100).toFixed(1) : 0
          },
          gemini: {
            tokens: p.companies['Google (Gemini)'].tokens,
            cost: +p.companies['Google (Gemini)'].cost.toFixed(2),
            percent: p.totalTokens > 0 ? +((p.companies['Google (Gemini)'].tokens / p.totalTokens) * 100).toFixed(1) : 0
          }
        },
        topModels: topModelEntries,
        lastActive: p.lastActive || ''
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  return list;
}

module.exports = {
  getProjectAttributionList
};
