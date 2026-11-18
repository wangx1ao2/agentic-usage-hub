import { animateNumber, feedbackButton, highlightChange, replaceAnimation, setText } from './motion.js';
import { state } from './state.js';
import { formatUSD, getLocalDateStr } from './utils.js';
import { renderTodayDashboard } from './today.js';
import { hideOverlay, showOverlay } from './experience.js';
// ──────────────────────────────────────────────────────────
// 10. Subscription ROI & Quota Utilization (启发一: 订阅制专属回本率与配额监控)
// ──────────────────────────────────────────────────────────

const SUBSCRIPTION_PLANS = {
  chatgpt_plus: {
    name: 'ChatGPT Plus',
    vendor: 'OpenAI',
    agent: 'codex',
    scopeName: 'OpenAI (Codex / ChatGPT)',
    monthlyFee: 20,
    weeklyAllowance: 130
  },
  chatgpt_pro: {
    name: 'ChatGPT Pro',
    vendor: 'OpenAI',
    agent: 'codex',
    scopeName: 'OpenAI (Codex / ChatGPT)',
    monthlyFee: 200,
    weeklyAllowance: 1300
  },
  chatgpt_team: {
    name: 'ChatGPT Team',
    vendor: 'OpenAI',
    agent: 'codex',
    scopeName: 'OpenAI (Codex / ChatGPT)',
    monthlyFee: 25,
    weeklyAllowance: 280
  },
  claude_pro: {
    name: 'Claude Pro',
    vendor: 'Anthropic',
    agent: 'claude',
    scopeName: 'Anthropic (Claude Code)',
    monthlyFee: 20,
    weeklyAllowance: 120
  },
  claude_team: {
    name: 'Claude Team',
    vendor: 'Anthropic',
    agent: 'claude',
    scopeName: 'Anthropic (Claude Code)',
    monthlyFee: 30,
    weeklyAllowance: 260
  },
  custom: {
    name: '自定义订阅',
    vendor: 'OpenAI',
    agent: 'codex',
    scopeName: '自定义范围',
    monthlyFee: 20,
    weeklyAllowance: 130
  }
};
const SUB_STORAGE_KEY = 'agentic_hub_sub_settings';
function getSubscriptionSettings() {
  const backendDefaults = state.cachedData?.meta?.subscriptionDefaults || {};
  let settings = {
    planKey: backendDefaults.defaultPlan || 'chatgpt_plus',
    customName: '自定义订阅',
    customVendor: 'OpenAI',
    customFee: backendDefaults.monthlyFee || 20,
    customAllowance: backendDefaults.weeklyAllowance || 130
  };
  try {
    const raw = localStorage.getItem(SUB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        settings = {
          ...settings,
          ...parsed
        };
      }
    }
  } catch (e) {}
  return settings;
}
function saveSubscriptionSettings(settings) {
  try {
    localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {}
}
function getCurrentActivePlan() {
  const settings = getSubscriptionSettings();
  if (settings.planKey === 'custom') {
    const v = settings.customVendor || 'OpenAI';
    const vendorMap = {
      'OpenAI': 'OpenAI (Codex / ChatGPT)',
      'Anthropic': 'Anthropic (Claude Code)',
      'Google': 'Google (Gemini / Antigravity)',
      'Zhipu': '智谱 AI (ZCode / GLM)',
      'DeepSeek': 'DeepSeek (OpenClaw)',
      'xAI': 'xAI (Grok)',
      'Qwen': '通义千问 (Qwen Code / DashScope)',
      'all': '全生态全部模型'
    };
    return {
      key: 'custom',
      name: settings.customName || '自定义订阅',
      vendor: v,
      agent: v === 'OpenAI' ? 'codex' : v === 'Anthropic' ? 'claude' : v.toLowerCase(),
      scopeName: vendorMap[v] || v,
      monthlyFee: Number(settings.customFee) || 20,
      weeklyAllowance: Number(settings.customAllowance) || 130
    };
  }
  const preset = SUBSCRIPTION_PLANS[settings.planKey] || SUBSCRIPTION_PLANS.chatgpt_plus;
  return {
    key: settings.planKey,
    ...preset
  };
}
function matchesPlanScope(company, agent, plan) {
  if (!plan || !plan.vendor || plan.vendor === 'all') return true;
  const comp = (company || '').toLowerCase();
  const ag = (agent || '').toLowerCase();
  if (plan.vendor === 'OpenAI') {
    return comp === 'openai' || ag === 'codex' || comp.includes('openai');
  }
  if (plan.vendor === 'Anthropic') {
    return comp === 'anthropic' || ag === 'claude' || comp.includes('anthropic');
  }
  if (plan.vendor === 'Google') {
    return comp.includes('google') || comp.includes('gemini') || ag === 'antigravity';
  }
  if (plan.vendor === 'Zhipu') {
    return comp.includes('智谱') || comp.includes('z.ai') || comp.includes('glm') || ag === 'zcode';
  }
  if (plan.vendor === 'DeepSeek') {
    return comp.includes('deepseek') || ag === 'openclaw' || ag === 'reasonix';
  }
  if (plan.vendor === 'xAI') {
    return comp === 'xai' || ag === 'grok' || comp.includes('xai');
  }
  if (plan.vendor === 'Qwen') {
    return comp.includes('qwen') || comp.includes('千问') || comp.includes('tongyi') || ag === 'qwen' || ag === 'qoderwork';
  }
  return comp.includes(plan.vendor.toLowerCase());
}
function renderSubscriptionROI() {
  if (!state.cachedData) return;
  const plan = getCurrentActivePlan();
  const settings = getSubscriptionSettings();
  const todayStr = state.cachedData.meta?.today || getLocalDateStr();
  const currentMonthPrefix = todayStr.slice(0, 7);
  const quotaNote = document.getElementById('today-codex-quota');
  const codexQuota = state.cachedData.todaySummary?.codexQuota;
  const latestQuota = codexQuota?.latest;
  if (quotaNote) {
    quotaNote.hidden = !latestQuota || plan.vendor !== 'OpenAI';
    if (!quotaNote.hidden) {
      const time = value => new Date(value).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const expired = Date.now() >= latestQuota.resetsAt;
      const completed = codexQuota.completedWindows?.at(-1);
      quotaNote.textContent = `本机 Codex 五小时额度：${latestQuota.usedPercent}% 已使用（${time(latestQuota.observedAt)} 日志记录${expired ? '，该窗口已结束' : `，${time(latestQuota.resetsAt)} 重置`}）` + (completed ? ` · 最近用满窗口截至 ${time(completed.reached100At)}，本机可见 API 等值约 ${formatUSD(completed.apiEquivalentAt100)}` : '');
    }
  }

  // 1. Sync dropdown selection
  const elSelect = document.getElementById('today-sub-plan-select');
  if (elSelect && elSelect.value !== settings.planKey) {
    elSelect.value = settings.planKey;
  }

  // Update scope badge in header
  const elScopeBadge = document.getElementById('today-sub-scope-badge');
  if (elScopeBadge) {
    elScopeBadge.innerText = `核算范围：${plan.scopeName || plan.name} · 按请求日志折算`;
  }

  // 2. Compute Filtered Today Cost (需求2: 仅计算属于该订阅方案的模型和Agent)
  let filteredTodayCost = 0;
  const todaySummary = state.cachedData.todaySummary;
  const todayTimeline = todaySummary || (state.cachedData.timeline || []).find(d => d.date === todayStr);
  if (todayTimeline && todayTimeline.byModel) {
    for (const [mName, mData] of Object.entries(todayTimeline.byModel)) {
      if (matchesPlanScope(mData.company, mData.agent, plan)) {
        filteredTodayCost += mData.cost || 0;
      }
    }
  }

  // 3. Compute Filtered Month-to-date Cost (需求2: 仅计算属于该订阅方案当月的模型消耗)
  let filteredMonthCost = 0;
  const monthDays = (state.cachedData.timeline || []).filter(d => d.date && d.date.startsWith(currentMonthPrefix));
  for (const day of monthDays) {
    if (!plan.vendor || plan.vendor === 'all') {
      filteredMonthCost += day.totalCost || 0;
    } else if (day.byModel) {
      for (const [mName, mData] of Object.entries(day.byModel)) {
        if (matchesPlanScope(mData.company, mData.agent, plan)) {
          filteredMonthCost += mData.cost || 0;
        }
      }
    } else if (day.byCompany && day.byCompany[plan.vendor]) {
      filteredMonthCost += day.byCompany[plan.vendor].cost || 0;
    }
  }

  // 4. Compute Metric 1: Today ROI
  const dailyCost = plan.monthlyFee > 0 ? plan.monthlyFee / 30 : 0;
  const todayRoi = dailyCost > 0 ? filteredTodayCost / dailyCost * 100 : 0;
  const elRoi = document.getElementById('today-stat-roi');
  const elRoiBadge = document.getElementById('today-roi-badge');
  const elRoiSub = document.getElementById('today-stat-roi-sub');
  const elCardRoi = document.getElementById('today-card-roi');
  if (elRoi) {
    const previous = Number(elRoi.dataset.ratio);
    animateNumber(elRoi, todayRoi, value => value >= 100 ? `+${value.toFixed(0)}%` : `${value.toFixed(1)}%`);
    if (elRoi.hasAttribute('data-ratio') && previous < 100 && todayRoi >= 100) highlightChange(elCardRoi, 400);
    elRoi.dataset.ratio = String(todayRoi);
  }
  if (elRoiBadge) {
    if (todayRoi >= 100) {
      elRoiBadge.innerText = 'API 等值高于日均费用';
      elRoiBadge.className = 'roi-badge roi-badge-good';
      if (elCardRoi) elCardRoi.className = 'today-roi-card roi-card-glow-green';
    } else {
      elRoiBadge.innerText = 'API 等值低于日均费用';
      elRoiBadge.className = 'roi-badge roi-badge-warn';
      if (elCardRoi) elCardRoi.className = 'today-roi-card roi-card-glow-amber';
    }
  }
  if (elRoiSub) {
    const vendorLabel = plan.vendor === 'all' ? '全生态' : plan.vendor === 'OpenAI' ? 'OpenAI/Codex' : plan.vendor;
    const costBreakdown = '（请求日志折算）';
    if (todayRoi >= 100) {
      const surplus = filteredTodayCost - dailyCost;
      elRoiSub.innerText = `${vendorLabel} API 等值 ${formatUSD(filteredTodayCost)}${costBreakdown} · 日均订阅费 ${formatUSD(dailyCost)} (差额 ${formatUSD(surplus)})`;
    } else {
      const remaining = Math.max(0, dailyCost - filteredTodayCost);
      elRoiSub.innerText = `${vendorLabel} API 等值 ${formatUSD(filteredTodayCost)}${costBreakdown} · 日均订阅费 ${formatUSD(dailyCost)} (差额 ${formatUSD(remaining)})`;
    }
  }

  // 5. Compute Metric 2: Daily Quota Utilization
  const dailyQuota = plan.weeklyAllowance > 0 ? plan.weeklyAllowance / 7 : 0;
  const quotaPct = dailyQuota > 0 ? filteredTodayCost / dailyQuota * 100 : 0;
  const clampedWidth = Math.min(100, Math.max(0, quotaPct));
  const elQuotaPct = document.getElementById('today-stat-quota-pct');
  const elQuotaBadge = document.getElementById('today-quota-badge');
  const elQuotaSub = document.getElementById('today-stat-quota-sub');
  const elQuotaBar = document.getElementById('today-quota-bar-fill');
  if (elQuotaPct) animateNumber(elQuotaPct,quotaPct,value=>`${value.toFixed(1)}%`);
  const previousBudget = Number(elQuotaBar?.dataset.percent);
  if (elQuotaBar) elQuotaBar.dataset.percent=String(quotaPct);
  if (Number.isFinite(previousBudget) && previousBudget<=100 && quotaPct>100) highlightChange(document.getElementById('today-card-quota'),400);
  if (elQuotaBar) {
    elQuotaBar.style.width = `${clampedWidth}%`;
    if (quotaPct > 100) {
      elQuotaBar.className = 'today-quota-bar-fill bar-overflow';
    } else if (quotaPct >= 80) {
      elQuotaBar.className = 'today-quota-bar-fill bar-warning';
    } else {
      elQuotaBar.className = 'today-quota-bar-fill bar-normal';
    }
  }
  if (elQuotaBadge) {
    if (quotaPct > 100) {
      elQuotaBadge.innerText = '超出自定预算';
      elQuotaBadge.className = 'roi-badge roi-badge-danger';
    } else if (quotaPct >= 80) {
      elQuotaBadge.innerText = '接近自定预算';
      elQuotaBadge.className = 'roi-badge roi-badge-warn';
    } else {
      elQuotaBadge.innerText = '自定预算内';
      elQuotaBadge.className = 'roi-badge roi-badge-good';
    }
  }
  if (elQuotaSub) {
    const vendorLabel = plan.vendor === 'all' ? '全量' : plan.vendor === 'OpenAI' ? 'OpenAI' : plan.vendor;
    if (quotaPct > 100) {
      elQuotaSub.innerText = `${vendorLabel}今日 ${formatUSD(filteredTodayCost)} / 自定日预算 ${formatUSD(dailyQuota)} (超出 ${(quotaPct - 100).toFixed(0)}%)`;
    } else {
      const remainingQuota = Math.max(0, dailyQuota - filteredTodayCost);
      elQuotaSub.innerText = `${vendorLabel}今日 ${formatUSD(filteredTodayCost)} / 自定日预算 ${formatUSD(dailyQuota)} (预算余量 ${formatUSD(remainingQuota)})`;
    }
  }

  // 6. Compute Metric 3: Month-to-date ROI Multiple
  const monthMultiple = plan.monthlyFee > 0 ? filteredMonthCost / plan.monthlyFee : 0;
  const elMonthRoi = document.getElementById('today-stat-month-roi');
  const elMonthBadge = document.getElementById('today-month-roi-badge');
  const elMonthSub = document.getElementById('today-stat-month-roi-sub');
  if (elMonthRoi) {
    const previous = Number(elMonthRoi.dataset.ratio);
    animateNumber(elMonthRoi,monthMultiple,value=>`${value.toFixed(2)}x`);
    if (elMonthRoi.hasAttribute('data-ratio') && previous<1 && monthMultiple>=1) highlightChange(elMonthRoi.closest('.today-roi-card'),400);
    elMonthRoi.dataset.ratio=String(monthMultiple);
  }
  if (elMonthBadge) {
    if (monthMultiple >= 1) {
      elMonthBadge.innerText = 'API 等值高于月费';
      elMonthBadge.className = 'roi-badge roi-badge-good';
    } else {
      elMonthBadge.innerText = `进度 ${(monthMultiple * 100).toFixed(0)}%`;
      elMonthBadge.className = 'roi-badge roi-badge-warn';
    }
  }
  if (elMonthSub) {
    const vendorLabel = plan.vendor === 'all' ? '全生态' : plan.vendor === 'OpenAI' ? 'OpenAI' : plan.vendor;
    if (monthMultiple >= 1) {
      elMonthSub.innerText = `${vendorLabel}当月 API 等值 ${formatUSD(filteredMonthCost)} · 订阅费 ${formatUSD(plan.monthlyFee)} (比值 ${monthMultiple.toFixed(1)} 倍)`;
    } else {
      const gap = Math.max(0, plan.monthlyFee - filteredMonthCost);
      elMonthSub.innerText = `${vendorLabel}当月 API 等值 ${formatUSD(filteredMonthCost)} · 订阅费 ${formatUSD(plan.monthlyFee)} (差额 ${formatUSD(gap)})`;
    }
  }
}
function onSubscriptionPlanChange(planKey) {
  const settings = getSubscriptionSettings();
  settings.planKey = planKey;
  saveSubscriptionSettings(settings);
  if (planKey === 'custom') {
    toggleCustomSubModal(true);
  } else {
    // Re-render today view with scoped metrics
    renderSubscriptionROI();
    highlightChange(document.getElementById('today-sub-scope-badge'),180);
  }
}
function toggleCustomSubModal(show) {
  const modal = document.getElementById('sub-config-modal');
  if (!modal) return;
  if (show) {
    const settings = getSubscriptionSettings();
    const nameInput = document.getElementById('sub-custom-name');
    const vendorSelect = document.getElementById('sub-custom-vendor');
    const feeInput = document.getElementById('sub-custom-fee');
    const allowanceInput = document.getElementById('sub-custom-allowance');
    if (nameInput) nameInput.value = settings.customName || '自定义订阅';
    if (vendorSelect) vendorSelect.value = settings.customVendor || 'OpenAI';
    if (feeInput) feeInput.value = settings.customFee || 20;
    if (allowanceInput) allowanceInput.value = settings.customAllowance || 130;
    showOverlay('sub-config-modal');
  } else {
    hideOverlay('sub-config-modal');
  }
}
function saveCustomSubscription() {
  const nameInput = document.getElementById('sub-custom-name');
  const vendorSelect = document.getElementById('sub-custom-vendor');
  const feeInput = document.getElementById('sub-custom-fee');
  const allowanceInput = document.getElementById('sub-custom-allowance');
  const customName = (nameInput?.value || '').trim() || '自定义订阅';
  const customVendor = vendorSelect?.value || 'OpenAI';
  const customFee = Number(feeInput?.value), customAllowance = Number(allowanceInput?.value);
  let error = document.getElementById('sub-config-error');
  if (!error) {
    error = document.createElement('p'); error.id='sub-config-error'; error.className='control-error'; error.setAttribute('role','alert');
    document.querySelector('#sub-config-modal .modal-card-body').appendChild(error);
  }
  const badFee = !Number.isFinite(customFee) || customFee<.1;
  const badAllowance = !Number.isFinite(customAllowance) || customAllowance<1;
  feeInput.setAttribute('aria-describedby','sub-config-error'); allowanceInput.setAttribute('aria-describedby','sub-config-error');
  feeInput.setAttribute('aria-invalid',String(badFee)); allowanceInput.setAttribute('aria-invalid',String(badAllowance));
  error.hidden=!badFee && !badAllowance;
  if (!error.hidden) {
    error.textContent=badFee ? '月度费用须为不小于 $0.10 的有效金额' : '每周预算须为不小于 $1 的有效金额';
    const invalid=badFee ? feeInput : allowanceInput;
    invalid.focus(); highlightChange(invalid,180); return;
  }
  const settings = getSubscriptionSettings();
  settings.planKey = 'custom';
  settings.customName = customName;
  settings.customVendor = customVendor;
  settings.customFee = customFee;
  settings.customAllowance = customAllowance;
  saveSubscriptionSettings(settings);
  toggleCustomSubModal(false);
  const elSelect = document.getElementById('today-sub-plan-select');
  if (elSelect) elSelect.value = 'custom';
  renderSubscriptionROI();
  feedbackButton(document.getElementById('btn-sub-config'));
}

// Attach functions to window for onclick/onchange handlers
export { SUBSCRIPTION_PLANS, SUB_STORAGE_KEY, getSubscriptionSettings, saveSubscriptionSettings, getCurrentActivePlan, matchesPlanScope, renderSubscriptionROI, onSubscriptionPlanChange, toggleCustomSubModal, saveCustomSubscription };
