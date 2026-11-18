/**
 * Agentic Usage Hub — 统一大模型价目矩阵与智能归因引擎
 * 集中管理主流 AI 厂商（Anthropic Claude, xAI Grok, OpenAI GPT, Google DeepMind Gemini, DeepSeek, 智谱 AI GLM, Qwen 等）
 * 计费标准口径：USD 美元 / 1M Tokens (包含 Prompt 缓存读取与阶梯定价)
 */

require('./lib/config');

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
    agentKey: 'qwen'
  },
  'Other / OpenSource': {
    label: '开源与主流通用模型',
    color: '#64748b',
    badgeClass: 'badge-other',
    agentKey: 'openclaw'
  }
};

// 阿里云百炼人民币目录价 → USD/1M tokens 换算（汇率可用 QWEN_USD_CNY_RATE 覆盖）
const QWEN_USD_CNY_RATE = Number(process.env.QWEN_USD_CNY_RATE) > 0 ? Number(process.env.QWEN_USD_CNY_RATE) : 7.15;
function qwen38Usd(cnyIn, cnyOut, cnyCache) {
  return {
    in: +(cnyIn / QWEN_USD_CNY_RATE).toFixed(3),
    out: +(cnyOut / QWEN_USD_CNY_RATE).toFixed(3),
    cache: +(cnyCache / QWEN_USD_CNY_RATE).toFixed(3)
  };
}

// 官方 API 标准价（USD / 1M tokens）。默认仅计短上下文文本 token；
// 批处理、长上下文、缓存写入/存储、工具调用和地区附加费需以账单为准。
// 核对日期：2026-10-08；来源见 README 的「模型价格」一节。
const MODEL_CATALOG = {
  // ── Anthropic Claude ───────────────────────────
  'claude-fable-5-1': { label: 'Claude Fable 5.1', company: 'Anthropic', agent: 'claude', standard: { in: 10, out: 50, cache: 0.25 } },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', company: 'Anthropic', agent: 'claude', standard: { in: 4, out: 20, cache: 0.2 } },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', company: 'Anthropic', agent: 'claude', standard: { in: 2, out: 10, cache: 0.1 } },
  // Haiku 5.5: requests above 100K prompt tokens use 0.5 / 2.5 / 0.05 instead.
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5 (≤100K)', company: 'Anthropic', agent: 'claude', standard: { in: 0.1, out: 0.5, cache: 0.01 } },
  'claude-fable-5': {
    label: 'Claude Fable 5 (Next-Gen Autonomous Agent)',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 10.00, out: 50.00, cache: 1.00 },
    flagship: { in: 10.00, out: 50.00, cache: 1.00 }
  },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', company: 'Anthropic', agent: 'claude', standard: { in: 2, out: 10, cache: 0.2 } },
  'claude-opus-5': { label: 'Claude Opus 5', company: 'Anthropic', agent: 'claude', standard: { in: 5, out: 25, cache: 0.5 } },
  'claude-opus-4-8': { label: 'Claude Opus 4.8', company: 'Anthropic', agent: 'claude', standard: { in: 5, out: 25, cache: 0.5 } },
  'claude-opus-4-7': { label: 'Claude Opus 4.7', company: 'Anthropic', agent: 'claude', standard: { in: 5, out: 25, cache: 0.5 } },
  'claude-opus-4-6': { label: 'Claude Opus 4.6', company: 'Anthropic', agent: 'claude', standard: { in: 5, out: 25, cache: 0.5 } },
  'claude-sonnet-4-6': { label: 'Claude Sonnet 4.6', company: 'Anthropic', agent: 'claude', standard: { in: 3, out: 15, cache: 0.3 } },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', company: 'Anthropic', agent: 'claude', standard: { in: 1, out: 5, cache: 0.1 } },
  'claude-4.5-sonnet': {
    label: 'Claude 4.5 Sonnet',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 3.00, out: 15.00, cache: 0.30 },
    flagship: { in: 3.00, out: 15.00, cache: 0.30 }
  },
  'claude-4.5-opus': {
    label: 'Claude 4.5 Opus',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 5.00, out: 25.00, cache: 0.50 },
    flagship: { in: 5.00, out: 25.00, cache: 0.50 }
  },
  'claude-4-haiku': {
    label: 'Claude 4 Haiku',
    company: 'Anthropic',
    agent: 'claude',
    standard: { in: 1.00, out: 5.00, cache: 0.10 },
    flagship: { in: 1.00, out: 5.00, cache: 0.10 }
  },
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
  'grok-4.7': { label: 'Grok 4.7', company: 'xAI', agent: 'grok', standard: { in: 2, out: 6, cache: 0.5 } },
  'grok-4.5': { label: 'Grok 4.5', company: 'xAI', agent: 'grok', standard: { in: 2, out: 6, cache: 0.3 } },
  'grok-4.3': { label: 'Grok 4.3', company: 'xAI', agent: 'grok', standard: { in: 1.25, out: 2.5, cache: 0.2 } },
  'grok-4.20-multi-agent-0309': { label: 'Grok 4.20 Multi Agent', company: 'xAI', agent: 'grok', standard: { in: 1.25, out: 2.5, cache: 0.2 } },
  'grok-4.20-0309-reasoning': { label: 'Grok 4.20 Reasoning', company: 'xAI', agent: 'grok', standard: { in: 1.25, out: 2.5, cache: 0.2 } },
  'grok-4.20-0309-non-reasoning': { label: 'Grok 4.20 Non Reasoning', company: 'xAI', agent: 'grok', standard: { in: 1.25, out: 2.5, cache: 0.2 } },
  'grok-build-0.1': { label: 'Grok Build 0.1', company: 'xAI', agent: 'grok', standard: { in: 1, out: 2, cache: 0.2 } },
  'grok-4.6': {
    label: 'Grok 4.6 (Flagship Multimodal / Reasoning)',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 2.00, out: 6.00, cache: 0.50 },
    flagship: { in: 2.00, out: 6.00, cache: 0.50 }
  },
  'grok-4': {
    label: 'Grok 4 (Advanced Reasoning)',
    company: 'xAI',
    agent: 'grok',
    standard: { in: 3.50, out: 17.50, cache: 0.70 },
    flagship: { in: 3.50, out: 17.50, cache: 0.70 }
  },
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
  // Standard, short-context API reference rates (USD / 1M tokens).
  // https://developers.openai.com/api/docs/models/compare
  'gpt-6-astra': {
    label: 'GPT-6 Astra', company: 'OpenAI', agent: 'codex',
    standard: { in: 10.00, out: 50.00, cache: 1.00 },
    flagship: { in: 10.00, out: 50.00, cache: 1.00 }
  },
  'gpt-6.1-sol': {
    label: 'GPT-6.1 Sol', company: 'OpenAI', agent: 'codex',
    standard: { in: 2.00, out: 10.00, cache: 0.10 },
    flagship: { in: 2.00, out: 10.00, cache: 0.10 }
  },
  // Verified 2026-10-27: https://developers.openai.com/api/docs/models/gpt-6.1-terra
  'gpt-6.1-terra': {
    label: 'GPT-6.1 Terra', company: 'OpenAI', agent: 'codex',
    standard: { in: 1.00, out: 5.00, cache: 0.05 },
    flagship: { in: 1.00, out: 5.00, cache: 0.05 }
  },
  'gpt-6-sol': {
    label: 'GPT-6 Sol', company: 'OpenAI', agent: 'codex',
    standard: { in: 2.00, out: 10.00, cache: 0.20 },
    flagship: { in: 2.00, out: 10.00, cache: 0.20 }
  },
  'gpt-6-luna': {
    label: 'GPT-6 Luna', company: 'OpenAI', agent: 'codex',
    standard: { in: 0.10, out: 0.50, cache: 0.01 },
    flagship: { in: 0.10, out: 0.50, cache: 0.01 }
  },
  'gpt-5.6-sol': {
    label: 'GPT-5.6 Sol',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 4.00, out: 20.00, cache: 0.40 },
    flagship: { in: 4.00, out: 20.00, cache: 0.40 }
  },
  'gpt-5.6-terra': {
    label: 'GPT-5.6 Terra',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 2.00, out: 12.00, cache: 0.20 },
    flagship: { in: 2.00, out: 12.00, cache: 0.20 }
  },
  'gpt-5.6-luna': {
    label: 'GPT-5.6 Luna',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 0.20, out: 1.20, cache: 0.02 },
    flagship: { in: 0.20, out: 1.20, cache: 0.02 }
  },
  'gpt-5.5': {
    label: 'GPT-5.5',
    company: 'OpenAI',
    agent: 'codex',
    standard: { in: 5.00, out: 30.00, cache: 0.50 },
    flagship: { in: 5.00, out: 30.00, cache: 0.50 }
  },
  'gpt-5.3-codex': { label: 'GPT-5.3 Codex', company: 'OpenAI', agent: 'codex', standard: { in: 1.75, out: 14, cache: 0.175 } },
  'gpt-5.4': { label: 'GPT-5.4', company: 'OpenAI', agent: 'codex', standard: { in: 2.5, out: 15, cache: 0.25 } },
  'gpt-5.4-mini': { label: 'GPT-5.4 Mini', company: 'OpenAI', agent: 'codex', standard: { in: 0.75, out: 4.5, cache: 0.075 } },
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
  'gemini-3.8-flash': { label: 'Gemini 3.8 Flash', company: 'Google (Gemini)', agent: 'antigravity', standard: { in: 0.75, out: 3.75, cache: 0.075 } },
  'gemini-3.6-flash': { label: 'Gemini 3.6 Flash', company: 'Google (Gemini)', agent: 'antigravity', standard: { in: 0.75, out: 3.75, cache: 0.075 } },
  'gemini-3.1-flash-lite': { label: 'Gemini 3.1 Flash-Lite', company: 'Google (Gemini)', agent: 'antigravity', standard: { in: 0.25, out: 1.5, cache: 0.025 } },
  'gemini-2.5-flash-lite': { label: 'Gemini 2.5 Flash-Lite', company: 'Google (Gemini)', agent: 'antigravity', standard: { in: 0.1, out: 0.4, cache: 0.01 } },
  'Gemini 3.7 Flash': {
    label: 'Gemini 3.7 Flash (Hybrid Thinking)',
    company: 'Google (Gemini)',
    agent: 'antigravity',
    standard: { in: 0.75, out: 3.75, cache: 0.075 },
    flagship: { in: 0.75, out: 3.75, cache: 0.075 }
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
  // DeepSeek 有按 UTC 时段收费的机制；目录使用峰时价，避免低估。
  'deepseek-flash': { label: 'DeepSeek V4.1 Flash', company: 'DeepSeek', agent: 'openclaw', standard: { in: 0.3, out: 1.2, cache: 0.006 } },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    company: 'DeepSeek',
    agent: 'openclaw',
    standard: { in: 1.32, out: 3.96, cache: 0.044 },
    flagship: { in: 1.32, out: 3.96, cache: 0.044 }
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
  'GLM-5.3-FlashX': { label: 'GLM-5.3-FlashX', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 0.37, out: 1.25, cache: 0.075 } },
  'GLM-5.1': { label: 'GLM-5.1', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 1.4, out: 4.4, cache: 0.26 } },
  'GLM-5': { label: 'GLM-5', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 1, out: 3.2, cache: 0.2 } },
  'GLM-4.7': { label: 'GLM-4.7', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 0.6, out: 2.2, cache: 0.11 } },
  'GLM-4.7-FlashX': { label: 'GLM-4.7-FlashX', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 0.07, out: 0.4, cache: 0.01 } },
  'GLM-4.6': { label: 'GLM-4.6', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 0.6, out: 2.2, cache: 0.11 } },
  'GLM-4.5': { label: 'GLM-4.5', company: '智谱 AI (Z.ai)', agent: 'zcode', standard: { in: 0.6, out: 2.2, cache: 0.11 } },
  'GLM-5.3-Flash': {
    label: 'GLM-5.3-Flash (High Concurrency)',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 0.15, out: 0.50, cache: 0.03 },
    flagship: { in: 0.15, out: 0.50, cache: 0.03 }
  },
  'GLM-5.3': {
    label: 'GLM-5.3 旗舰版',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 1.40, out: 4.40, cache: 0.26 },
    flagship: { in: 1.40, out: 4.40, cache: 0.26 }
  },
  'GLM-5.2': {
    label: 'GLM-5.2',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 1.40, out: 4.40, cache: 0.26 },
    flagship: { in: 1.40, out: 4.40, cache: 0.26 }
  },
  'GLM-4-Plus': {
    label: 'GLM-4-Plus',
    company: '智谱 AI (Z.ai)',
    agent: 'zcode',
    standard: { in: 1.00, out: 3.00, cache: 0.20 },
    flagship: { in: 1.00, out: 3.00, cache: 0.20 }
  },

  // ── Alibaba Cloud Qwen (通义千问 · 阿里云百炼/DashScope 目录价) ──
  'qwen3-max': {
    label: 'Qwen3 Max (通义旗舰)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 1.20, out: 6.00, cache: 0.30 },
    flagship: { in: 1.20, out: 6.00, cache: 0.30 }
  },
  'qwen-max': {
    label: 'Qwen Max (通义旗舰)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 1.60, out: 6.40, cache: 0.40 },
    flagship: { in: 1.60, out: 6.40, cache: 0.40 }
  },
  'qwen-plus': {
    label: 'Qwen Plus (通义均衡)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.40, out: 1.20, cache: 0.16 },
    flagship: { in: 0.40, out: 1.20, cache: 0.16 }
  },
  'qwen-turbo': {
    label: 'Qwen Turbo (通义轻快)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.05, out: 0.20, cache: 0.02 },
    flagship: { in: 0.05, out: 0.20, cache: 0.02 }
  },
  'qwen3-coder-plus': {
    label: 'Qwen3 Coder Plus (代码旗舰)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 1.00, out: 5.00, cache: 0.40 },
    flagship: { in: 1.00, out: 5.00, cache: 0.40 }
  },
  'qwen3-coder-flash': {
    label: 'Qwen3 Coder Flash (代码轻快)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.375, out: 1.50, cache: 0.15 },
    flagship: { in: 0.375, out: 1.50, cache: 0.15 }
  },
  'qwen3-235b-a22b': {
    label: 'Qwen3 235B A22B (开源旗舰 MoE)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.20, out: 1.60, cache: 0.05 },
    flagship: { in: 0.20, out: 1.60, cache: 0.05 }
  },
  'qwen-vl-max': {
    label: 'Qwen VL Max (多模态视觉)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.80, out: 3.20, cache: 0.20 },
    flagship: { in: 0.80, out: 3.20, cache: 0.20 }
  },
  'qwq-32b': {
    label: 'QwQ 32B (深度推理)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.20, out: 2.00, cache: 0.05 },
    flagship: { in: 0.20, out: 2.00, cache: 0.05 }
  },
  'qwen-2.5-coder-32b': {
    label: 'Qwen 2.5 Coder 32B',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.20, out: 0.60, cache: 0.05 },
    flagship: { in: 0.20, out: 0.60, cache: 0.05 }
  },
  'qwen-2.5-72b': {
    label: 'Qwen 2.5 72B',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: { in: 0.35, out: 1.00, cache: 0.08 },
    flagship: { in: 0.35, out: 1.00, cache: 0.08 }
  },

  // ── Qwen3.8 系列（2026-09 阿里云百炼官方价：Max 12/36/1.5 元，Flash 0.8/2.7/0.1 元/百万 tokens；
  //    按 QWEN_USD_CNY_RATE（默认 7.15）折算 USD 展示）──
  'qwen3.8-max': {
    label: 'Qwen3.8 Max (通义新一代旗舰)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: qwen38Usd(12, 36, 1.5),
    flagship: qwen38Usd(12, 36, 1.5)
  },
  'qwen3.8-flash': {
    label: 'Qwen3.8 Flash (通义轻快)',
    company: 'Qwen (通义千问)',
    agent: 'qwen',
    standard: qwen38Usd(0.8, 2.7, 0.1),
    flagship: qwen38Usd(0.8, 2.7, 0.1)
  },
  'qwen3.8-27b': { label: 'Qwen3.8 27B', company: 'Qwen (通义千问)', agent: 'qwen', standard: qwen38Usd(3, 12, 0.6) },
  'qwen3.7-max': { label: 'Qwen3.7 Max', company: 'Qwen (通义千问)', agent: 'qwen', standard: qwen38Usd(12, 36, 2.4) },
  'qwen3.7-plus': { label: 'Qwen3.7 Plus (≤256K)', company: 'Qwen (通义千问)', agent: 'qwen', standard: qwen38Usd(2, 8, 0.4) },
  'qwen3.7-flash': { label: 'Qwen3.7 Flash (≤32K)', company: 'Qwen (通义千问)', agent: 'qwen', standard: qwen38Usd(0.2, 0.8, 0.04) },

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

// A routing ID is not evidence of a model or tariff. Public defaults remain
// unpriced; a local, explicitly configured model supplies an optional estimate.
const autoReviewRateModel = (process.env.CODEX_AUTO_REVIEW_RATE_MODEL || '').trim();
const autoReviewRate = Object.hasOwn(MODEL_CATALOG, autoReviewRateModel) ? MODEL_CATALOG[autoReviewRateModel] : null;
MODEL_CATALOG['codex-auto-review'] = {
  label: autoReviewRate ? `codex-auto-review（按 ${autoReviewRate.label} 估算）` : 'codex-auto-review（未配置估算费率）',
  company: 'OpenAI', agent: 'codex',
  standard: autoReviewRate?.standard || { in: 0, out: 0, cache: 0 },
  flagship: autoReviewRate?.flagship || autoReviewRate?.standard || { in: 0, out: 0, cache: 0 },
  unpriced: !autoReviewRate, assumedRateModel: autoReviewRate ? autoReviewRateModel : null,
  pricingAssumption: autoReviewRate ? `user-selected-${autoReviewRateModel}` : null
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
      pricing: { in: 0, out: 0, cache: 0 },
      unpriced: true
    };
  }

  let cleaned = String(rawModelName).trim();
  // 移除常见的路由前缀 (如 anthropic/, openai/, deepseek/, xai/, dashscope/, aliyun/)
  cleaned = cleaned.replace(/^(anthropic|openai|google|deepseek|zhipu|xai|alibaba|meta|mistral|dashscope|tongyi|aliyun|qwen)\//i, '');
  // 移除末尾的日期快照版本号 (如 -20250219, -20241022, @20250101)
  const baseKey = cleaned.replace(/[-_@](20\d{6}|\d{8})$/, '');
  const unpriced = (company, agent) => ({ canonicalName: cleaned, label: cleaned, company, agent, pricing: { in: 0, out: 0, cache: 0 }, unpriced: true });
  const fromCatalog = (key) => {
    const item = MODEL_CATALOG[key];
    return { canonicalName: key, label: item.label, company: item.company, agent: item.agent, pricing: item.standard,
      ...(item.unpriced ? { unpriced: true } : {}),
      ...(item.assumedRateModel ? { assumedRateModel: item.assumedRateModel, pricingAssumption: item.pricingAssumption } : {}) };
  };

  // 1. 精确匹配
  if (Object.hasOwn(MODEL_CATALOG, cleaned)) {
    return fromCatalog(cleaned);
  }
  if (Object.hasOwn(MODEL_CATALOG, baseKey)) {
    return fromCatalog(baseKey);
  }

  // 官方 ID、大小写和日期快照。仅允许已知型号的别名，防止新版本套用老价格。
  const lower = baseKey.toLowerCase();
  const knownKey = Object.keys(MODEL_CATALOG).find(key => key.toLowerCase() === lower);
  if (knownKey) return fromCatalog(knownKey);
  if (lower === 'gpt-5.6') return fromCatalog('gpt-5.6-sol');
  if (lower === 'gemini-3.7-flash') return fromCatalog('Gemini 3.7 Flash');
  if (lower === 'deepseek-v4-flash' || lower === 'deepseek-v4.1-flash') return fromCatalog('deepseek-flash');
  if (lower === 'qwen3.8-vl-27b') return fromCatalog('qwen3.8-27b');
  if (/^qwen3\.7-(max|plus|flash)-20\d{2}-\d{2}-\d{2}$/.test(lower)) return fromCatalog(lower.replace(/-20\d{2}-\d{2}-\d{2}$/, ''));
  const claudeId = lower.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?$/);
  if (claudeId) {
    const [, family, major, minor] = claudeId;
    const key = major === '4' && minor === '5' && family !== 'haiku'
      ? `claude-4.5-${family}` : `claude-${family}-${major}-${minor}`;
    if (MODEL_CATALOG[key]) return fromCatalog(key);
  }
  if (lower === 'claude-sonnet-5' || lower === 'claude-opus-5') return fromCatalog(lower);
  if (lower === 'claude-fable-5-preview') return fromCatalog('claude-fable-5');
  if (lower.startsWith('claude-') && /(5|4-\d)/.test(lower)) return unpriced('Anthropic', 'claude');
  if (/^gpt-[\d.]+/.test(lower) || /^(o\d|codex)/.test(lower)) return unpriced('OpenAI', 'codex');
  if (lower.startsWith('grok-4.') && !MODEL_CATALOG[lower]) return unpriced('xAI', 'grok');
  if (lower.startsWith('gemini-3.') && lower !== 'gemini-3.7-flash') return unpriced('Google (Gemini)', 'antigravity');
  if (lower.startsWith('glm-') && !knownKey) return unpriced('智谱 AI (Z.ai)', 'zcode');

  // 2. 模糊匹配规则链
  const m = cleaned.toLowerCase();

  // Anthropic Claude
  if (m.includes('fable') || m.includes('claude-5') || m.includes('claude-fable')) {
    return { canonicalName: 'claude-fable-5', label: 'Claude Fable 5 (Next-Gen Autonomous Agent)', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-fable-5'].standard };
  }
  if (m.includes('claude-4.5') || m.includes('claude-4-5')) {
    if (m.includes('opus')) {
      return { canonicalName: 'claude-4.5-opus', label: 'Claude 4.5 Opus', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-4.5-opus'].standard };
    }
    return { canonicalName: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-4.5-sonnet'].standard };
  }
  if (m.includes('claude-4')) {
    if (m.includes('haiku')) {
      return { canonicalName: 'claude-4-haiku', label: 'Claude 4 Haiku', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-4-haiku'].standard };
    }
    return { canonicalName: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet', company: 'Anthropic', agent: 'claude', pricing: MODEL_CATALOG['claude-4.5-sonnet'].standard };
  }
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
  if (m.includes('grok-4.6') || m.includes('grok-4-6') || m.includes('grok4.6')) {
    return { canonicalName: 'grok-4.6', label: 'Grok 4.6 (Flagship Multimodal / Reasoning)', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-4.6'].standard };
  }
  if (m.includes('grok-4') || m.includes('grok4')) {
    return { canonicalName: 'grok-4', label: 'Grok 4 (Advanced Reasoning)', company: 'xAI', agent: 'grok', pricing: MODEL_CATALOG['grok-4'].standard };
  }
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
  if (m.includes('deepseek-v4-flash')) {
    return fromCatalog('deepseek-flash');
  }
  if (m.includes('deepseek')) {
    return unpriced('DeepSeek', 'openclaw');
  }

  // Google Gemini
  if (m.includes('gemini-3.7') || m.includes('gemini 3.7')) {
    return { canonicalName: 'Gemini 3.7 Flash', label: 'Gemini 3.7 Flash', company: 'Google (Gemini)', agent: 'antigravity', pricing: MODEL_CATALOG['Gemini 3.7 Flash'].standard };
  }
  if (m.includes('gemini-2.5-pro')) {
    return { canonicalName: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', company: 'Google (Gemini)', agent: 'antigravity', pricing: MODEL_CATALOG['gemini-2.5-pro'].standard };
  }
  if (m.includes('gemini-2.5-flash')) return fromCatalog('gemini-2.5-flash');
  if (m.includes('gemini-2.0')) {
    return { canonicalName: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', company: 'Google (Gemini)', agent: 'antigravity', pricing: MODEL_CATALOG['gemini-2.0-flash'].standard };
  }
  if (m.includes('gemini')) return unpriced('Google (Gemini)', 'antigravity');

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

  // Qwen / 通义千问 / DashScope 系 (含 QwQ 推理模型)
  if (m.includes('qwen') || m.includes('qwq') || m.includes('tongyi')) {
    const q = (key, fallbackLabel) => ({ canonicalName: key, label: MODEL_CATALOG[key].label || fallbackLabel, company: 'Qwen (通义千问)', agent: 'qwen', pricing: MODEL_CATALOG[key].standard });
    if (m.includes('3.8') || m.includes('3-8')) {
      if (m.includes('vl') || m.includes('vision') || m.includes('27b')) return q('qwen3.8-27b');
      if (m.includes('flash')) return q('qwen3.8-flash');
      return q('qwen3.8-max');
    }
    if (m.includes('3.7') || m.includes('3-7')) {
      if (m.includes('flash')) return q('qwen3.7-flash');
      if (m.includes('plus')) return q('qwen3.7-plus');
      if (m.includes('max')) return q('qwen3.7-max');
      return unpriced('Qwen (通义千问)', 'qwen');
    }
    if (m.includes('2.5') && m.includes('coder')) return q('qwen-2.5-coder-32b');
    if (m.includes('coder') && (m.includes('flash') || m.includes('30b'))) return q('qwen3-coder-flash');
    if (m.includes('coder')) return q('qwen3-coder-plus');
    if (m.includes('vl') || m.includes('vision')) return q('qwen-vl-max');
    if (m.includes('235b') || m.includes('a22b')) return q('qwen3-235b-a22b');
    if (m.includes('qwq')) return q('qwq-32b');
    if (m.includes('turbo')) return q('qwen-turbo');
    if (m.includes('plus')) return q('qwen-plus');
    if (m.includes('max')) {
      if (m.includes('3') && !m.includes('2.5')) return q('qwen3-max');
      return q('qwen-max');
    }
    if (m.includes('72b') && m.includes('2.5')) return q('qwen-2.5-72b');
    return q('qwen-plus', 'Qwen Plus');
  }

  // QoderWork CN 内部模型键 (qfmodel / qmodel / qmodel_38max …)
  if (m === 'auto' || /^q[fd]?model/.test(m) || m.includes('qoder')) {
    if (m.includes('flash') || m.startsWith('qfmodel')) {
      return { canonicalName: 'qwen3.8-flash', label: 'Qwen3.8 Flash (QoderWork)', company: 'Qwen (通义千问)', agent: 'qoderwork', pricing: MODEL_CATALOG['qwen3.8-flash'].standard };
    }
    if (m.includes('turbo')) {
      return { canonicalName: 'qwen-turbo', label: 'Qwen Turbo (QoderWork)', company: 'Qwen (通义千问)', agent: 'qoderwork', pricing: MODEL_CATALOG['qwen-turbo'].standard };
    }
    return { canonicalName: 'qwen3.8-max', label: 'Qwen3.8 Max (QoderWork)', company: 'Qwen (通义千问)', agent: 'qoderwork', pricing: MODEL_CATALOG['qwen3.8-max'].standard };
  }

  // OpenAI fallback
  if (m.startsWith('gpt-6')) {
    return { canonicalName: cleaned, label: cleaned, company: 'OpenAI', agent: 'codex', pricing: { in: 0, out: 0, cache: 0 }, unpriced: true };
  }
  if (m.includes('gpt-5.6-sol')) {
    return { canonicalName: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', company: 'OpenAI', agent: 'codex', pricing: MODEL_CATALOG['gpt-5.6-sol'].standard };
  }
  if (m.includes('gpt-5.6-terra')) {
    return { canonicalName: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', company: 'OpenAI', agent: 'codex', pricing: MODEL_CATALOG['gpt-5.6-terra'].standard };
  }
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('codex')) {
    return unpriced('OpenAI', 'codex');
  }

  // Default fallback
  return unpriced('Other / OpenSource', defaultAgent);
}

/**
 * 统一根据 Tokens 与定价策略计算美元金额
 */
function calculateModelCost(modelName, inTok = 0, outTok = 0, cacheTok = 0, tier = 'standard') {
  const info = resolveModelInfo(modelName);
  const catalogItem = Object.hasOwn(MODEL_CATALOG, info.canonicalName) ? MODEL_CATALOG[info.canonicalName] : null;
  let p = info.pricing;

  if (catalogItem) {
    p = (tier === 'flagship' && catalogItem.flagship) ? catalogItem.flagship : (catalogItem.standard || p);
  }

  const freshIn = Math.max(0, (inTok || 0) - (cacheTok || 0));
  const cost = (freshIn * (p.in || 0) + (cacheTok || 0) * (p.cache || 0) + (outTok || 0) * (p.out || 0)) / 1e6;
  return +cost.toFixed(6);
}

/**
 * M3 / P3：resolveModelInfo 是看板热路径函数（buildDashboardData 单次可能触发数百到数千次），
 * 每次都要 trim + 2 个正则 + toLowerCase + 30+ 次 includes。用模块级 Map 记忆化，
 * key = rawModelName + 分隔符 + defaultAgent，命中直接返回同一（约定只读）对象。
 *
 * I3：底层规则链硬引用 MODEL_CATALOG['<key>'].standard，若将来有人删除某个目录键会抛
 * TypeError 拖垮整个请求。这里用 try/catch 兜底，异常时标记暂无费率，保证不 500。
 */
const _resolveRaw = resolveModelInfo;
const _resolveCache = new Map();
const RESOLVE_CACHE_MAX = 5000;

function resolveModelInfoCached(rawModelName, defaultAgent = 'openclaw') {
  const key = (rawModelName == null ? '\u0000' : String(rawModelName)) + '\u0001' + (defaultAgent || '');
  const hit = _resolveCache.get(key);
  if (hit !== undefined) return hit;

  let value;
  try {
    value = _resolveRaw(rawModelName, defaultAgent);
  } catch (e) {
    const cleaned = String(rawModelName || 'unknown').trim() || 'unknown';
    value = {
      canonicalName: cleaned,
      label: cleaned,
      company: 'Other / OpenSource',
      agent: defaultAgent || 'openclaw',
      pricing: { in: 0, out: 0, cache: 0 },
      unpriced: true
    };
  }

  if (_resolveCache.size >= RESOLVE_CACHE_MAX) _resolveCache.clear(); // 防无界增长
  _resolveCache.set(key, value);
  return value;
}

// 重绑模块级引用：calculateModelCost 及所有 `require(...).resolveModelInfo` 消费者都会走到记忆化版本
resolveModelInfo = resolveModelInfoCached;

module.exports = {
  COMPANY_CONFIG,
  MODEL_CATALOG,
  resolveModelInfo,
  calculateModelCost,
  autoReviewCostBasis: !autoReviewRate ? 'unpriced' : autoReviewRateModel === 'gpt-6.1-sol' ? 'user-assumed-sol-rate' : 'user-assumed-model-rate'
};
