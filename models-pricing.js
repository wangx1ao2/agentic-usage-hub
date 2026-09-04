/**
 * Agentic Usage Hub — 统一大模型价目矩阵与智能归因引擎
 * 集中管理主流 AI 厂商（Anthropic Claude, xAI Grok, OpenAI GPT, Google DeepMind Gemini, DeepSeek, 智谱 AI GLM, Qwen 等）
 * 计费标准口径：USD 美元 / 1M Tokens (包含 Prompt 缓存读取与阶梯定价)
 */

const COMPANY_CONFIG = {
  'OpenAI': {
    label: 'OpenAI (Codex / GPT)',
    color: '#3b82f6',
    badgeClass: 'badge-openai',
    agentKey: 'codex'
  },
  'Anthropic': {
    label: 'Anthropic (Claude)',
    color: '#d97706',
    badgeClass: 'badge-anthropic',
    agentKey: 'claude'
  },
  'xAI': {
    label: 'xAI (Grok)',
    color: '#8b5cf6',
    badgeClass: 'badge-xai',
    agentKey: 'grok'
  },
  'Google (Gemini)': {
    label: 'Google DeepMind (Gemini)',
    color: '#06b6d4',
    badgeClass: 'badge-google',
    agentKey: 'antigravity'
  },
  '智谱 AI (Z.ai)': {
    label: '智谱 AI (GLM-5.3)',
    color: '#10b981',
    badgeClass: 'badge-zhipu',
    agentKey: 'zcode'
  },
  'DeepSeek': {
    label: 'DeepSeek',
    color: '#f43f5e',
    badgeClass: 'badge-deepseek',
    agentKey: 'openclaw'
  },
  'Qwen (通义千问)': {
    label: 'Alibaba Cloud (Qwen)',
    color: '#ec4899',
    badgeClass: 'badge-qwen',
    agentKey: 'openclaw'
  },
  'Other / OpenSource': {
    label: '开源与主流通用模型',
    color: '#64748b',
    badgeClass: 'badge-other',
    agentKey: 'openclaw'
  }
};

// 官方标准目录价与旗舰折算价 (单位: USD / 1M Tokens)
const MODEL_CATALOG = {
  // ── Anthropic Claude ───────────────────────────
  'claude-3-7-sonnet': {
    label: 'Claude 3.7 Sonnet (Hybrid Reasoning)',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 3.00, out: 15.00, cache: 0.30 },
    flagship: { in: 3.00, out: 15.00, cache: 0.30 }
  },
  'claude-3-5-sonnet': {
    label: 'Claude 3.5 Sonnet',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 3.00, out: 15.00, cache: 0.30 },
    flagship: { in: 3.00, out: 15.00, cache: 0.30 }
  },
  'claude-3-5-haiku': {
    label: 'Claude 3.5 Haiku',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 0.80, out: 4.00, cache: 0.08 },
    flagship: { in: 0.80, out: 4.00, cache: 0.08 }
  },
  'claude-3-opus': {
    label: 'Claude 3 Opus',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 15.00, out: 75.00, cache: 1.50 },
    flagship: { in: 15.00, out: 75.00, cache: 1.50 }
  },
  'claude-3-haiku': {
    label: 'Claude 3 Haiku',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 0.25, out: 1.25, cache: 0.025 },
    flagship: { in: 0.25, out: 1.25, cache: 0.025 }
  },

  // ── xAI Grok ────────────────────────────────────
  'grok-3': {
    label: 'Grok 3 (Thinking / Code)',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 3.00, out: 15.00, cache: 0.75 },
    flagship: { in: 3.00, out: 15.00, cache: 0.75 }
  },
  'grok-3-mini': {
    label: 'Grok 3 Mini',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 0.50, out: 2.00, cache: 0.125 },
    flagship: { in: 0.50, out: 2.00, cache: 0.125 }
  },
  'grok-2': {
    label: 'Grok 2 (1212)',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 2.00, out: 10.00, cache: 0.20 },
    flagship: { in: 2.00, out: 10.00, cache: 0.20 }
  },
  'grok-2-vision': {
    label: 'Grok 2 Vision',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 2.00, out: 10.00, cache: 0.20 },
    flagship: { in: 2.00, out: 10.00, cache: 0.20 }
  },
  'grok-beta': {
    label: 'Grok Beta',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 5.00, out: 15.00, cache: 1.25 },
    flagship: { in: 5.00, out: 15.00, cache: 1.25 }
  },

  // ── OpenAI ──────────────────────────────────────
  'gpt-5.6-sol': {
    label: 'GPT-5.6 Sol',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 1.75, out: 14.00, cache: 0.53375 },
    flagship: { in: 1.75, out: 14.00, cache: 0.53375 }
  },
  'gpt-5.6-terra': {
    label: 'GPT-5.6 Terra',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 0.75, out: 6.00, cache: 0.375 },
    flagship: { in: 0.75, out: 6.00, cache: 0.375 }
  },
  'gpt-5.6-luna': {
    label: 'GPT-5.6 Luna',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 0.25, out: 2.00, cache: 0.125 },
    flagship: { in: 0.25, out: 2.00, cache: 0.125 }
  },
  'gpt-5.5': {
    label: 'GPT-5.5',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 2.50, out: 10.00, cache: 1.25 },
    flagship: { in: 2.50, out: 10.00, cache: 1.25 }
  },
  'o3-mini': {
    label: 'o3-mini (Reasoning)',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 1.10, out: 4.40, cache: 0.55 },
    flagship: { in: 1.10, out: 4.40, cache: 0.55 }
  },
  'o1': {
    label: 'o1',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 15.00, out: 60.00, cache: 7.50 },
    flagship: { in: 15.00, out: 60.00, cache: 7.50 }
  },
  'o1-mini': {
    label: 'o1-mini',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 1.10, out: 4.40, cache: 0.55 },
    flagship: { in: 1.10, out: 4.40, cache: 0.55 }
  },
  'gpt-4o': {
    label: 'GPT-4o',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 2.50, out: 10.00, cache: 1.25 },
    flagship: { in: 2.50, out: 10.00, cache: 1.25 }
  },
  'gpt-4o-mini': {
    label: 'GPT-4o Mini',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 0.15, out: 0.60, cache: 0.075 },
    flagship: { in: 0.15, out: 0.60, cache: 0.075 }
  },

  // ── Google DeepMind ─────────────────────────────
  'Gemini 3.7 Flash': {
    label: 'Gemini 3.7 Flash (Hybrid Thinking)',
    company: 'Google (Gemini)',
    agent: 'antigravity',
    standard: { in: 0.15, out: 0.60, cache: 0.0375 },
    flagship: { in: 0.15, out: 0.60, cache: 0.0375 }
  },
  'gemini-2.5-pro': {
    label: 'Gemini 2.5 Pro',
    company: 'Google (Gemini)',
    agent: 'antigravity',
    standard: { in: 1.25, out: 5.00, cache: 0.3125 },
    flagship: { in: 1.25, out: 5.00, cache: 0.3125 }
  },
  'gemini-2.5-flash': {
    label: 'Gemini 2.5 Flash',
    company: 'Google (Gemini)',
    agent: 'antigravity',
    standard: { in: 0.15, out: 0.60, cache: 0.0375 },
    flagship: { in: 0.15, out: 0.60, cache: 0.0375 }
  },
  'gemini-2.0-flash': {
    label: 'Gemini 2.0 Flash',
    company: 'Google (Gemini)',
    agent: 'antigravity',
    standard: { in: 0.10, out: 0.40, cache: 0.025 },
    flagship: { in: 0.10, out: 0.40, cache: 0.025 }
  },

  // ── DeepSeek ────────────────────────────────────
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    company: 'DeepSeek',
    agent: 'openclaw',
    standard: { in: 0.55, out: 2.19, cache: 0.14 },
    flagship: { in: 0.55, out: 2.19, cache: 0.14 }
  },
  'deepseek-v4-flash': {
    label: 'DeepSeek V4 Flash',
    company: 'DeepSeek',
    agent: 'openclaw',
    standard: { in: 0.14, out: 0.28, cache: 0.028 },
    flagship: { in: 0.14, out: 0.28, cache: 0.028 }
  },
  'deepseek-reasoner': {
    label: 'DeepSeek R1 (Reasoner)',
    company: 'DeepSeek',
    agent: 'openclaw',
    standard: { in: 0.55, out: 2.19, cache: 0.14 },
    flagship: { in: 0.55, out: 2.19, cache: 0.14 }
  },
  'deepseek-chat': {
    label: 'DeepSeek V3 (Chat)',
    company: 'DeepSeek',
    agent: 'openclaw',
    standard: { in: 0.14, out: 0.28, cache: 0.014 },
    flagship: { in: 0.14, out: 0.28, cache: 0.014 }
  },

  // ── 智谱 AI (Z.ai) ──────────────────────────────
  'GLM-5.3-Flash': {
    label: 'GLM-5.3-Flash (High Concurrency)',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 0.15, out: 0.50, cache: 0.03 },
    flagship: { in: 1.00, out: 3.00, cache: 0.20 }
  },
  'GLM-5.3': {
    label: 'GLM-5.3 旗舰版',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 1.00, out: 3.00, cache: 0.20 },
    flagship: { in: 1.00, out: 3.00, cache: 0.20 }
  },
  'GLM-5.2': {
    label: 'GLM-5.2',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 0.80, out: 2.50, cache: 0.15 },
    flagship: { in: 1.00, out: 3.00, cache: 0.20 }
  },
  'GLM-4-Plus': {
    label: 'GLM-4-Plus',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 1.00, out: 3.00, cache: 0.20 },
    flagship: { in: 1.00, out: 3.00, cache: 0.20 }
  },

  // ── Alibaba Cloud Qwen ──────────────────────────
  'qwen-2.5-coder-32b': {
    label: 'Qwen 2.5 Coder 32B',
    company: 'Qwen (通义千问)',
    agent: 'openclaw',
    standard: { in: 0.20, out: 0.60, cache: 0.05 },
    flagship: { in: 0.20, out: 0.60, cache: 0.05 }
  },
  'qwen-2.5-72b': {
    label: 'Qwen 2.5 72B',
    company: 'Qwen (通义千问)',
    agent: 'openclaw',
    standard: { in: 0.35, out: 1.00, cache: 0.08 },
    flagship: { in: 0.35, out: 1.00, cache: 0.08 }
  },
  'qwen-max': {
    label: 'Qwen Max (通义旗舰)',
    company: 'Qwen (通义千问)',
    agent: 'openclaw',
    standard: { in: 1.60, out: 6.40, cache: 0.40 },
    flagship: { in: 1.60, out: 6.40, cache: 0.40 }
  },

  // ── 其他开源/第三方主流 ─────────────────────────
  'kimi-k1.5': {
    label: 'Kimi k1.5 (Moonshot)',
    company: 'Other / OpenSource',
    agent: 'openclaw',
    standard: { in: 1.20, out: 1.20, cache: 0.30 },
    flagship: { in: 1.20, out: 1.20, cache: 0.30 }
  },
  'mistral-large': {
    label: 'Mistral Large 2',
    company: 'Other / OpenSource',
    agent: 'openclaw',
    standard: { in: 2.00, out: 6.00, cache: 0.50 },
    flagship: { in: 2.00, out: 6.00, cache: 0.50 }
  },
  'codestral': {
    label: 'Codestral (Mistral Code)',
    company: 'Other / OpenSource',
    agent: 'openclaw',
    standard: { in: 0.30, out: 0.90, cache: 0.075 },
    flagship: { in: 0.30, out: 0.90, cache: 0.075 }
  },
  'llama-3.3-70b': {
    label: 'Llama 3.3 70B (Meta)',
    company: 'Other / OpenSource',
    agent: 'openclaw',
    standard: { in: 0.35, out: 0.90, cache: 0.08 },
    flagship: { in: 0.35, out: 0.90, cache: 0.08 }
  }
};

/**
 * 智能模糊规整与模型名称解析器
 * 抹平厂商前缀 (anthropic/claude-3-7-sonnet-20250219 -> claude-3-7-sonnet)
 */
function resolveModelInfo(rawModelName, defaultAgent = 'openclaw') {
  if (!rawModelName) {
    return {
      canonicalName: 'unknown',
      label: 'Unknown Model',
      company: 'Other / OpenSource',
      agent: defaultAgent,
      pricing: { in: 0.50, out: 1.50, cache: 0.10 }
    };
  }

  let cleaned = String(rawModelName).trim();
  // 移除常见的路由前缀 (如 anthropic/, openai/, deepseek/, xai/)
  cleaned = cleaned.replace(/^(anthropic|openai|google|deepseek|zhipu|xai|alibaba|meta|mistral)\//i, '');
  // 移除末尾的日期快照版本号 (如 -20250219, -20241022, @20250101)
  const baseKey = cleaned.replace(/[-_@](20\d{6}|\d{8})$/, '');

  // 1. 精确匹配
  if (MODEL_CATALOG[cleaned]) {
    const item = MODEL_CATALOG[cleaned];
    return { canonicalName: cleaned, label: item.label, company: item.company, agent: item.agent, pricing: item.standard };
  }
  if (MODEL_CATALOG[baseKey]) {
    const item = MODEL_CATALOG[baseKey];
    return { canonicalName: baseKey, label: item.label, company: item.company, agent: item.agent, pricing: item.standard };
  }

  // 2. 模糊匹配规则链
  const m = cleaned.toLowerCase();

  // Anthropic Claude
  if (m.includes('claude-3-7') || m.includes('claude-3.7')) {
    return { canonicalName: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-3-7-sonnet'].standard };
  }
  if (m.includes('claude-3-5-sonnet') || m.includes('claude-3.5-sonnet')) {
    return { canonicalName: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-3-5-sonnet'].standard };
  }
  if (m.includes('claude-3-5-haiku') || m.includes('claude-3.5-haiku')) {
    return { canonicalName: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-3-5-haiku'].standard };
  }
  if (m.includes('opus')) {
    return { canonicalName: 'claude-3-opus', label: 'Claude 3 Opus', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-3-opus'].standard };
  }
  if (m.includes('claude') && m.includes('haiku')) {
    return { canonicalName: 'claude-3-haiku', label: 'Claude 3 Haiku', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-3-haiku'].standard };
  }
  if (m.includes('claude')) {
    return { canonicalName: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-3-5-sonnet'].standard };
  }

  // xAI Grok
  if (m.includes('grok-3-mini')) {
    return { canonicalName: 'grok-3-mini', label: 'Grok 3 Mini', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-3-mini'].standard };
  }
  if (m.includes('grok-3')) {
    return { canonicalName: 'grok-3', label: 'Grok 3', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-3'].standard };
  }
  if (m.includes('grok-2-vision')) {
    return { canonicalName: 'grok-2-vision', label: 'Grok 2 Vision', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-2-vision'].standard };
  }
  if (m.includes('grok-2') || m.includes('grok-2-1212')) {
    return { canonicalName: 'grok-2', label: 'Grok 2', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-2'].standard };
  }
  if (m.includes('grok')) {
    return { canonicalName: 'grok-2', label: 'Grok 2', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-2'].standard };
  }

  // DeepSeek
  if (m.includes('deepseek') && (m.includes('reasoner') || m.includes('r1'))) {
    return { canonicalName: 'deepseek-reasoner', label: 'DeepSeek R1', company: 'DeepSeek', agent: 'openclaw', pricing: MODEL_CATALOG['deepseek-reasoner'].standard };
  }
  if (m.includes('deepseek-v4-pro')) {
    return { canonicalName: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', company: 'DeepSeek', agent: 'openclaw', pricing: MODEL_CATALOG['deepseek-v4-pro'].standard };
  }
  if (m.includes('deepseek-v4-flash') || m.includes('deepseek')) {
    return { canonicalName: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', company: 'DeepSeek', agent: 'openclaw', pricing: MODEL_CATALOG['deepseek-v4-flash'].standard };
  }

  // Google Gemini
  if (m.includes('gemini-3.7') || m.includes('gemini 3.7')) {
    return { canonicalName: 'Gemini 3.7 Flash', label: 'Gemini 3.7 Flash', company: 'Google (Gemini)', agent: 'antigravity', pricing: MODEL_CATALOG['Gemini 3.7 Flash'].standard };
  }
  if (m.includes('gemini-2.5-pro')) {
    return { canonicalName: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', company: 'Google (Gemini)', agent: 'antigravity', pricing: MODEL_CATALOG['gemini-2.5-pro'].standard };
  }
  if (m.includes('gemini-2.0') || m.includes('gemini')) {
    return { canonicalName: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', company: 'Google (Gemini)', agent: 'antigravity', pricing: MODEL_CATALOG['gemini-2.0-flash'].standard };
  }

  // 智谱 GLM
  if (m.includes('glm-5.3-flash')) {
    return { canonicalName: 'GLM-5.3-Flash', label: 'GLM-5.3-Flash', company: '智谱 AI (Z.ai)', agent: 'zcode', pricing: MODEL_CATALOG['GLM-5.3-Flash'].standard };
  }
  if (m.includes('glm-5.3')) {
    return { canonicalName: 'GLM-5.3', label: 'GLM-5.3', company: '智谱 AI (Z.ai)', agent: 'zcode', pricing: MODEL_CATALOG['GLM-5.3'].standard };
  }
  if (m.includes('glm')) {
    return { canonicalName: 'GLM-5.3-Flash', label: 'GLM-5.3-Flash', company: '智谱 AI (Z.ai)', agent: 'zcode', pricing: MODEL_CATALOG['GLM-5.3-Flash'].standard };
  }

  // Qwen
  if (m.includes('qwen') && m.includes('coder')) {
    return { canonicalName: 'qwen-2.5-coder-32b', label: 'Qwen 2.5 Coder', company: 'Qwen (通义千问)', agent: 'openclaw', pricing: MODEL_CATALOG['qwen-2.5-coder-32b'].standard };
  }
  if (m.includes('qwen')) {
    return { canonicalName: 'qwen-2.5-72b', label: 'Qwen 2.5 72B', company: 'Qwen (通义千问)', agent: 'openclaw', pricing: MODEL_CATALOG['qwen-2.5-72b'].standard };
  }

  // OpenAI fallback
  if (m.includes('gpt-5.6-sol')) {
    return { canonicalName: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', company: 'OpenAI', agent: 'codex', pricing: MODEL_CATALOG['gpt-5.6-sol'].standard };
  }
  if (m.includes('gpt-5.6-terra')) {
    return { canonicalName: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', company: 'OpenAI', agent: 'codex', pricing: MODEL_CATALOG['gpt-5.6-terra'].standard };
  }
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('codex')) {
    return { canonicalName: 'gpt-5.5', label: 'GPT-5.5', company: 'OpenAI', agent: 'codex', pricing: MODEL_CATALOG['gpt-5.5'].standard };
  }

  // Default fallback
  return {
    canonicalName: cleaned,
    label: cleaned,
    company: 'Other / OpenSource',
    agent: defaultAgent,
    pricing: { in: 0.50, out: 1.50, cache: 0.10 }
  };
}

/**
 * 统一根据 Tokens 与定价策略计算美元金额
 */
function calculateModelCost(modelName, inTok = 0, outTok = 0, cacheTok = 0, tier = 'standard') {
  const info = resolveModelInfo(modelName);
  const catalogItem = MODEL_CATALOG[info.canonicalName];
  let p = info.pricing;

  if (catalogItem) {
    p = (tier === 'flagship' && catalogItem.flagship) ? catalogItem.flagship : (catalogItem.standard || p);
  }

  const freshIn = Math.max(0, (inTok || 0) - (cacheTok || 0));
  const cost = (freshIn * (p.in || 0) + (cacheTok || 0) * (p.cache || 0) + (outTok || 0) * (p.out || 0)) / 1e6;
  return +cost.toFixed(6);
}

module.exports = {
  COMPANY_CONFIG,
  MODEL_CATALOG,
  resolveModelInfo,
  calculateModelCost
};
