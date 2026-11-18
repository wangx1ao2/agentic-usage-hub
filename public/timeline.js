import { getMotionPolicy, highlightChange, replaceAnimation, setText } from './motion.js';
import { state } from './state.js';
import { getFilteredTimeline, renderAll, setAgentFilter } from './app.js';
import { reconcileMarkup, animateDisclosure, calendarTimeline, emptyState, esc, formatTokens, formatUSD, getLocalDateStr, reconcileCards, renderPagination, renderSparkline } from './utils.js';
import { animateValue } from './experience.js';
import { getEffectiveTheme } from './theme.js';
function updateChartContext() {
  if (!state.chartInstance || !state.cachedData) return;
  const displayed = state.chartInstance.data.datasets.filter((_, index) => state.chartInstance.isDatasetVisible(index));
  const available = state.chartInstance.data.datasets.length;
  const timeline = getFilteredTimeline();
  const models = new Set(timeline.flatMap(day => Object.entries(day.byModel || {}).filter(([, data]) => (data[state.currentAxisMode] || data[state.currentAxisMode === 'cost' ? 'cost' : 'tokens']) > 0).map(([name]) => name)));
  const agent = state.cachedData.meta?.agentFilter || 'all';
  const name = document.querySelector(`.agent-tab[data-agent="${agent}"]`)?.textContent.trim() || '全部来源';
  const scope = state.chartDimension === 'model' ? `${displayed.length}/${models.size} 个活跃模型` : `${displayed.length}/${available} 个活跃来源`;
  const missing = calendarTimeline(timeline).filter(day => day.missing).length;
  const context = document.getElementById('chart-context');
  if (context) context.textContent = `${state.startDate || '全部日期'} — ${state.endDate || '至今'} · ${name} · ${state.currentAxisMode === 'cost' ? 'USD / 日' : 'Token / 日'} · 显示 ${scope}${missing ? ` · ${missing} 天无记录，连接相邻记录点` : ''}${state.isLogScale ? ' · 对数刻度' : ''}`;
  const warning = document.getElementById('chart-range-warning');
  if (!warning) return;
  const limit = state.chartInstance.options.scales.y.max;
  const clipped = Number.isFinite(limit) ? displayed.reduce((sum, dataset) => sum + dataset.data.filter(value => value != null && value > limit).length, 0) : 0;
  const entering = warning.hidden && clipped > 0;
  warning.hidden = clipped === 0;
  warning.replaceChildren();
  if (clipped) {
    const text = document.createElement('span');
    text.textContent = `当前纵轴上限 ${state.currentAxisMode === 'cost' ? formatUSD(limit) : formatTokens(limit)}，${clipped} 个数据点超出显示范围。`;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn-chip';
    reset.textContent = '恢复完整刻度';
    reset.onclick = resetZoomAndScale;
    warning.append(text, reset);
    if (entering) replaceAnimation(warning,'range-warning',[{opacity:0},{opacity:1}],{duration:180});
  }
}
// 1. Render Metric Cards (4 Balanced Symmetric Cards)
function renderMetrics(timeline) {
  const {
    companies
  } = state.cachedData;
  const imageDays = ['all', 'codex'].includes(state.currentAgentFilter) ? (state.cachedData.imageAnalysis?.daily || []).filter(day => state.currentDatePreset === 'all' || (!state.startDate || day.date >= state.startDate) && (!state.endDate || day.date <= state.endDate)) : [];
  const allImageTotals = state.currentDatePreset === 'all' && ['all', 'codex'].includes(state.currentAgentFilter) ? state.cachedData.imageAnalysis?.totals : null;
  const imageTokens = allImageTotals?.totalTokens ?? imageDays.reduce((sum, day) => sum + (day.tokens || 0), 0);
  const textTokens = timeline.reduce((s, d) => s + d.totalTokens, 0);
  const totalCost = timeline.reduce((s, d) => s + d.totalCost, 0);
  const totalTokens = textTokens;
  const cacheTokens = timeline.reduce((s, d) => s + d.cacheReadTokens, 0);
  const cacheRate = textTokens > 0 ? +(cacheTokens / textTokens * 100).toFixed(1) : 0;

  // Card 1: Total Cost
  const hasUnpriced = timeline.some(day => Object.values(day.byModel || {}).some(model => model.unpriced || model.costComplete === false));
  animateValue('stat-total-cost', totalCost, hasUnpriced && totalCost === 0 && totalTokens > 0 ? () => '—' : formatUSD);
  document.getElementById('stat-total-cost').title = hasUnpriced ? '金额仅包含已定价请求；未定价模型未计入' : '当前范围的模型 API 等值估算';

  // Breakdown by company in current window
  const compSpend = {};
  for (const day of timeline) {
    for (const [cName, cData] of Object.entries(day.byCompany)) {
      compSpend[cName] = (compSpend[cName] || 0) + (cData.cost || 0);
    }
  }
  const leading = Object.entries(compSpend).sort((a, b) => b[1] - a[1]).slice(0, 2);
  document.getElementById('stat-cost-breakdown').innerText = hasUnpriced && !totalCost ? '存在未定价模型，暂无完整金额' : (hasUnpriced ? '已定价部分 · ' : '') + (leading.length ? leading.map(([name, cost]) => `${name} ${formatUSD(cost)}`).join(' · ') : '当前范围暂无消耗');

  // Card 2: Total Tokens
  animateValue('stat-total-tokens', totalTokens, formatTokens);
  document.getElementById('stat-tokens-sub').innerText = imageTokens > 0 ? '含输入、输出与缓存读取 · 生图 Token 等值另列' : '含输入、输出与缓存读取';
  document.getElementById('stat-total-tokens').title = `${totalTokens.toLocaleString()} Token`;

  // Card 3: Cache Read
  animateValue('stat-cache-tokens', cacheTokens, formatTokens);
  document.getElementById('stat-cache-rate').innerText = `${imageTokens > 0 ? '文本' : ''}缓存读取占比 ${cacheRate}%`;

  // Card 4: Google Gemini Usage in this window
  const activeDays = new Set([...timeline.filter(d => d.totalTokens > 0 || d.totalCost > 0).map(d => d.date), ...imageDays.filter(d => d.count > 0 || d.cost > 0 || d.tokens > 0).map(d => d.date)]).size;
  animateValue('stat-gemini-usage', activeDays, value => `${Math.round(value)} 天`);
  document.getElementById('stat-gemini-sub').innerText = hasUnpriced && !totalCost ? '金额记录尚不完整' : `活跃日均等值 ${formatUSD(activeDays ? totalCost / activeDays : 0)}`;
  const calendar = calendarTimeline(timeline);
  renderSparkline('stat-cost-sparkline', calendar.map(day => day.missing ? null : day.totalCost));
  renderSparkline('stat-tokens-sparkline', calendar.map(day => day.missing ? null : day.totalTokens));
  renderSparkline('stat-cache-sparkline', calendar.map(day => day.missing ? null : day.cacheReadTokens));
  renderSparkline('stat-days-sparkline', calendar.map(day => day.missing ? null : day.totalTokens > 0 || day.totalCost > 0 ? 1 : 0));
  const activeSources = state.cachedData.companies.filter(company => timeline.some(day => (day.byCompany?.[company.name]?.tokens || 0) > 0 || (day.byCompany?.[company.name]?.cost || 0) > 0)).length;
  document.getElementById('timeline-scope-summary').textContent = `${state.startDate} — ${state.endDate} · ${timeline.length} 天有数据 · ${activeSources} 个活跃来源`;
}

// Helper for dynamic model branding colors
function getModelColor(mName) {
  const m = (mName || '').toLowerCase();
  if (m.includes('fable') || m.includes('claude')) return '#d97706'; // Anthropic Amber
  if (m.includes('grok')) return '#8b5cf6'; // xAI Purple
  if (m.includes('gemini')) return '#06b6d4'; // Gemini Cyan
  if (m.includes('glm') || m.includes('zcode')) return '#10b981'; // ZCode Emerald
  if (m.includes('deepseek')) return '#f43f5e'; // DeepSeek Rose
  if (m.includes('image')) return '#ec4899'; // Image Pink
  if (m.includes('qwen')) return '#f59e0b'; // Qwen Orange
  if (m.includes('terra')) return '#38bdf8';
  if (m.includes('luna')) return '#818cf8';
  return '#3b82f6'; // OpenAI Blue default
}
function setChartDimension(dim) {
  state.chartDimension = dim;
  document.querySelectorAll('.axis-switch button[id^="dim-"]').forEach(btn => {
    btn.classList.toggle('active', btn.id === `dim-${dim}`);
  });
  const title = document.getElementById('chart-main-title');
  const desc = document.getElementById('chart-main-desc');
  if (dim === 'company') {
    if (title) title.innerText = '每日来源消耗';
    if (desc) desc.innerText = '按厂商聚合；点击图例显示或隐藏曲线';
  } else {
    if (title) title.innerText = '每日模型消耗';
    if (desc) desc.innerText = '按当前单位排列活跃模型；更多曲线可在图表设置中查看';
  }
  renderChart(getFilteredTimeline());
}

// 2. Render Company / Model Independent Line Chart (with Zoom & Y-Scale support)
function setChartSeriesLimit(value) {
  state.chartSeriesLimit = value === 'all' ? Infinity : Number(value) || 8;
  renderChart(getFilteredTimeline());
}
function renderChart(timeline, animate = true) {
  if (!state.cachedData) return;
  timeline = calendarTimeline(timeline);
  const canvas = document.getElementById('mainChart');
  const isLight = getEffectiveTheme() === 'light';
  const reduced = !getMotionPolicy().enabled;
  const metric = state.currentAxisMode === 'cost' ? 'cost' : 'tokens';
  const signature = `${metric}:${state.chartDimension}:${state.isLogScale}`;
  const incompatible = state.chartMotionSignature && state.chartMotionSignature !== signature;
  state.chartMotionSignature = signature;
  const colors = isLight ? ['#245ec0', '#7040be', '#087b57', '#b72c4d', '#087c96', '#94611b', '#53647f', '#a34289'] : ['#829cf4', '#b09bef', '#65b69a', '#e990a6', '#67c3ce', '#dcb36b', '#a6bad2', '#d19abe'];
  let series;
  if (state.chartDimension === 'company') {
    series = state.cachedData.companies.map(company => ({
      ...company,
      key: 'company:' + company.name,
      values: timeline.map(day => day.missing ? null : Number(day.byCompany?.[company.name]?.[metric]) || 0)
    })).filter(company => company.values.some(value => value > 0));
  } else {
    const totals = new Map();
    for (const day of timeline) for (const [name, data] of Object.entries(day.byModel || {})) {
      totals.set(name, (totals.get(name) || 0) + (Number(data[metric]) || 0));
    }
    series = [...totals].filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1]).slice(0, state.chartSeriesLimit).map(([name]) => ({
      name,
      label: name,
      key: 'model:' + name,
      values: timeline.map(day => day.missing ? null : Number(day.byModel?.[name]?.[metric]) || 0)
    }));
  }
  const datasets = series.map((source, index) => {
    const hash = [...source.name].reduce((sum, c) => sum * 31 + c.charCodeAt(0) >>> 0, 0);
    const color = state.chartDimension === 'company' ? source.color || colors[index % colors.length] : colors[hash % colors.length];
    return {
      label: source.label || source.name,
      seriesKey: source.key,
      companyName: state.chartDimension === 'company' ? source.name : undefined,
      modelName: state.chartDimension === 'model' ? source.name : undefined,
      data: source.values.map(value => value == null || state.isLogScale && value <= 0 ? null : value),
      hidden: state.chartSeriesVisibility.get(source.key) === false,
      borderColor: color,
      backgroundColor: color + '12',
      borderWidth: 2,
      borderDash: state.chartDimension === 'model' ? [[], [5, 3], [2, 3]][Math.floor(hash / colors.length) % 3] : [],
      pointStyle: ['circle', 'rect', 'triangle'][hash % 3],
      pointRadius: context => {
        const values = context.dataset.data,
          index = context.dataIndex;
        if (values[index] == null) return 0;
        return values[index - 1] == null && values[index + 1] == null ? 3 : timeline.length > 20 ? 0 : 2;
      },
      pointHoverRadius: 5,
      // Keep missing dates as null while connecting the surrounding recorded values.
      tension: 0,
      fill: false,
      spanGaps: true
    };
  });
  const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  const text = isLight ? '#526073' : '#969ba8';
  const grid = isLight ? '#1823360b' : '#ffffff08';
  const y = {
    type: state.isLogScale ? 'logarithmic' : 'linear',
    beginAtZero: !state.isLogScale,
    border: {
      display: false
    },
    grid: {
      color: grid
    },
    ticks: {
      color: text,
      maxTicksLimit: 7,
      font: {
        family: mono,
        size: 11
      },
      callback: value => state.currentAxisMode === 'cost' ? '$' + Number(value).toLocaleString('en-US', {
        maximumFractionDigits: 2
      }) : formatTokens(value)
    }
  };
  if (state.customYMax > 0) y.max = state.customYMax;else if (state.yScaleMode === 'micro') y.max = state.currentAxisMode === 'cost' ? 20 : 50000000;else if (state.yScaleMode === 'mid') y.max = state.currentAxisMode === 'cost' ? 50 : 100000000;
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduced || !animate || incompatible ? false : {
      duration: state.chartInstance ? 240 : 400,
      easing: 'easeOutCubic'
    },
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: isLight ? '#fffffffa' : '#1a1c25fa',
        titleColor: isLight ? '#172030' : '#eeeeF4',
        bodyColor: text,
        borderColor: isLight ? '#dfe3ea' : '#ffffff20',
        borderWidth: 1,
        padding: 12,
        usePointStyle: true,
        animation: { duration: reduced ? 0 : 100 },
        itemSort: (a, b) => Number(b.raw || 0) - Number(a.raw || 0),
        filter: item => Number(item.raw) > 0,
        callbacks: {
          title: items => items.length ? timeline[items[0].dataIndex]?.date : '',
          label: context => ` ${context.dataset.label}: ${state.currentAxisMode === 'cost' ? '$' + Number(context.raw).toFixed(4) : formatTokens(context.raw) + ' Tokens'}`
        }
      }
    },
    scales: {
      x: {
        border: {
          display: false
        },
        grid: {
          display: false
        },
        ticks: {
          color: text,
          maxRotation: 0,
          maxTicksLimit: innerWidth < 600 ? 5 : 10,
          font: {
            family: mono,
            size: 11
          }
        }
      },
      y
    }
  };
  const crossYear = timeline.length && timeline[0].date.slice(0, 4) !== timeline.at(-1).date.slice(0, 4);
  const labels = timeline.map(day => crossYear ? day.date.replace(/-/g, '/') : day.date.slice(5));
  if (state.chartInstance) {
    state.chartInstance.data.labels = labels;
    state.chartInstance.stop();
    const oldDatasets = new Map(state.chartInstance.data.datasets.map(dataset => [dataset.seriesKey,dataset]));
    state.chartInstance.data.datasets = datasets.map(dataset => {
      const previous = oldDatasets.get(dataset.seriesKey);
      return previous && !incompatible ? Object.assign(previous,dataset) : dataset;
    });
    state.chartInstance.options = options;
    state.chartInstance.update(reduced || !animate || incompatible ? 'none' : undefined);
    if (incompatible && animate) replaceAnimation(canvas,'chart-switch',[{opacity:.2},{opacity:1}],{duration:180});
  } else {
    state.chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets
      },
      options,
      plugins: [{
        id: 'dateCrosshair',
        afterDatasetsDraw(chart) {
          const active = chart.tooltip?.getActiveElements();
          if (!active?.length) return;
          const x = active[0].element.x,
            ctx = chart.ctx;
          ctx.save();
          ctx.beginPath();
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = getEffectiveTheme() === 'light' ? '#52607355' : '#969ba855';
          ctx.moveTo(x, chart.chartArea.top);
          ctx.lineTo(x, chart.chartArea.bottom);
          ctx.stroke();
          ctx.restore();
          for (const item of active) {
            if (!Number.isFinite(item.element.y)) continue;
            ctx.save(); ctx.globalAlpha = .3; ctx.lineWidth = 2;
            ctx.strokeStyle = chart.data.datasets[item.datasetIndex].borderColor;
            ctx.beginPath(); ctx.arc(item.element.x,item.element.y,7,0,Math.PI*2); ctx.stroke(); ctx.restore();
          }
        }
      }]
    });
  }
  if (!canvas.dataset.motionDrawn && datasets.length) {
    canvas.dataset.motionDrawn = 'true';
    replaceAnimation(canvas,'chart-reveal',[{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0 0 0)'}],{duration:400});
  }
  const empty = document.getElementById('chart-empty-state');
  if (empty) {
    empty.hidden = datasets.length > 0;
    if (!datasets.length) {
      const hasTokens = timeline.some(day => day.totalTokens > 0);
      empty.replaceChildren(hasTokens && state.currentAxisMode === 'cost' ? emptyState('当前范围有 Token 记录，暂无可绘制的金额数据', '查看 Token 走势', () => setAxisMode('tokens')) : emptyState('当前筛选范围暂无消耗记录', '查看全部记录', () => {
        state.currentAgentFilter = 'all';
        setDatePreset('all');
        setAgentFilter('all');
      }));
    }
  }
  canvas.style.visibility = datasets.length ? 'visible' : 'hidden';
  canvas.setAttribute('aria-label', `${state.chartDimension === 'company' ? '厂商' : '模型'}${state.currentAxisMode === 'cost' ? 'API 等值估算' : 'Token 用量'}走势，${timeline.length} 天，${datasets.length} 个来源。完整数值见下方明细表。`);
  const legend = document.getElementById('chart-legend');
  const legendColors = datasets.map(dataset=>dataset.borderColor);
  const oldButtons = new Map([...legend.children].map(el => [el.dataset.key, el]));
  const buttons = datasets.map((ds, index) => {
    const button = oldButtons.get(ds.seriesKey) || document.createElement('button');
    button.type = 'button';
    button.className = 'legend-badge';
    button.dataset.key = ds.seriesKey;
    button.classList.toggle('disabled', ds.hidden);
    button.setAttribute('aria-pressed', String(!ds.hidden));
    button.innerHTML = `<span class="legend-dot" style="background-color:${ds.borderColor}"></span><span>${esc(ds.label)}</span>`;
    button.onclick = () => {
      const visible = !state.chartInstance.isDatasetVisible(index);
      state.chartSeriesVisibility.set(ds.seriesKey, visible);
      state.chartInstance.setDatasetVisibility(index, visible);
      button.classList.toggle('disabled', !visible);
      button.setAttribute('aria-pressed', String(visible));
      state.chartInstance.update(reduced ? 'none' : undefined);
      updateChartContext();
    };
    const focusSeries = () => {
      state.chartInstance.data.datasets.forEach((d, i) => {
        d.borderWidth = i === index ? 3 : 1.2;
        d.borderColor = i === index ? legendColors[i] : /^#[0-9a-f]{6}$/i.test(legendColors[i]) ? legendColors[i] + '55' : legendColors[i];
      });
      state.chartInstance.update('none');
    };
    const restoreSeries = () => {
      state.chartInstance.data.datasets.forEach((d,i) => {
        d.borderWidth = 2;
        d.borderColor = legendColors[i];
      });
      state.chartInstance.update('none');
    };
    button.onpointerenter = focusSeries; button.onfocus = focusSeries;
    button.onpointerleave = restoreSeries; button.onblur = restoreSeries;
    return button;
  });
  buttons.forEach((button, index) => {
    if (legend.children[index] !== button) legend.insertBefore(button, legend.children[index] || null);
  });
  [...legend.children].forEach(button => {
    if (!buttons.includes(button)) button.remove();
  });
  updateChartContext();
}

// 3. Render Company Distribution Matrix
function renderCompanyGrid(timeline) {
  const metric = state.currentAxisMode === 'cost' ? 'cost' : 'tokens';
  const entries = state.cachedData.companies.map(company => {
    const cost = timeline.reduce((sum, day) => sum + (day.byCompany?.[company.name]?.cost || 0), 0);
    const tokens = timeline.reduce((sum, day) => sum + (day.byCompany?.[company.name]?.tokens || 0), 0);
    const days = timeline.filter(day => (day.byCompany?.[company.name]?.tokens || 0) > 0 || (day.byCompany?.[company.name]?.cost || 0) > 0).length;
    const hasUnpriced = timeline.some(day => Object.values(day.byModel || {}).some(model => model.company === company.name && model.unpriced));
    return {
      ...company,
      cost,
      tokens,
      days,
      hasUnpriced
    };
  });
  const active = entries.filter(entry => entry.cost > 0 || entry.tokens > 0).sort((a, b) => b[metric] - a[metric]);
  const inactive = entries.filter(entry => entry.cost === 0 && entry.tokens === 0);
  const total = active.reduce((sum, entry) => sum + entry[metric], 0);
  const grid = document.getElementById('company-grid');
  const cards = active.map((entry, index) => {
    const share = total > 0 ? entry[metric] / total * 100 : 0;
    const row = document.createElement('div');
    row.className = 'source-row';
    row.dataset.key = entry.name;
    row.style.setProperty('--source-color', entry.color || 'var(--accent-blue)');
    row.innerHTML = `<div class="source-identity"><span class="source-rank font-mono">${String(index + 1).padStart(2, '0')}</span><span class="source-name">${esc(entry.label || entry.name)}</span></div>
      <div class="source-amount font-mono">${metric === 'cost' ? entry.hasUnpriced && !entry.cost ? '暂无参考价' : formatUSD(entry.cost) : formatTokens(entry.tokens) + ' Token'}</div>
      <span class="source-share font-mono">${share.toFixed(1)}%</span>
      <div class="source-meter" aria-hidden="true"><span style="width:${share.toFixed(2)}%"></span></div>
      <div class="source-caption">${metric === 'cost' ? formatTokens(entry.tokens) + ' Token' : formatUSD(entry.cost)} · ${entry.days} 个活跃日${entry.hasUnpriced ? ' · 仅计已定价金额' : ''}</div>`;
    return row;
  });
  reconcileCards(grid, cards);
  // Reconciliation keeps each row; its color is a property of that stable source.
  [...grid.children].forEach((row, index) => row.style.setProperty('--source-color', active[index].color || 'var(--accent-blue)'));
  if (!active.length) grid.replaceChildren(emptyState('当前范围暂无活跃来源'));
  document.getElementById('company-count').textContent = `${active.length} 个活跃来源`;
  const details = document.getElementById('inactive-sources');
  details.hidden = !inactive.length;
  document.getElementById('inactive-sources-label').textContent = `本区间未使用来源 · ${inactive.length}`;
  document.getElementById('inactive-source-list').replaceChildren(...inactive.map(entry => {
    const chip = document.createElement('span');
    chip.textContent = entry.label || entry.name;
    return chip;
  }));
}

// State to track expanded model families

// Default expand OpenAI/ChatGPT

function toggleFamilyExpand(familyId, event) {
  if (event) event.stopPropagation();
  const subList = document.getElementById(familyId);
  const btn = document.getElementById('btn-' + familyId);
  if (!subList) return;
  const fromHeight = subList.getBoundingClientRect().height;
  const isExpanded = subList.classList.toggle('expanded');
  btn?.setAttribute('aria-expanded', String(isExpanded));
  subList.setAttribute('aria-hidden', String(!isExpanded));
  subList.inert = !isExpanded;
  animateDisclosure(subList, isExpanded, { fromHeight });
  if (isExpanded) {
    state.expandedFamilies.add(familyId);
    if (btn) btn.querySelector('.disclosure-label').textContent = '收起';
  } else {
    state.expandedFamilies.delete(familyId);
    if (btn) btn.querySelector('.disclosure-label').textContent = '展开';
  }
}

// 4. Render Model Ranking List (按公司大类合并 · 可点击展开明细)
function renderModelRanking(timeline) {
  const list = document.getElementById('model-rank-list');
  const nextCards = [];

  // Calculate stats for each model within this timeline window
  const modelMap = {};
  for (const day of timeline) {
    for (const [mName, mData] of Object.entries(day.byModel)) {
      if (!modelMap[mName]) {
        modelMap[mName] = {
          modelName: mName,
          cost: 0,
          tokens: 0,
          agent: mData.agent,
          company: mData.company,
          unpriced: false
        };
      }
      modelMap[mName].cost += mData.cost;
      modelMap[mName].tokens += mData.tokens;
      modelMap[mName].unpriced ||= !!mData.unpriced;
    }
  }

  // Family definitions (6 core major families)
  const familyDefs = [{
    id: 'openai',
    name: 'ChatGPT / OpenAI 全系模型',
    company: 'OpenAI',
    color: '#3b82f6',
    badge: 'OpenAI',
    badgeClass: 'badge-codex'
  }, {
    id: 'claude',
    name: 'Anthropic Claude 全系模型',
    company: 'Anthropic',
    color: '#d97706',
    badge: 'Claude',
    badgeClass: 'badge-anthropic'
  }, {
    id: 'grok',
    name: 'xAI Grok 全系模型',
    company: 'xAI',
    color: '#8b5cf6',
    badge: 'Grok',
    badgeClass: 'badge-xai'
  }, {
    id: 'zcode',
    name: '智谱 GLM 全系模型',
    company: '智谱 AI (Z.ai)',
    color: '#10b981',
    badge: '智谱',
    badgeClass: 'badge-zcode'
  }, {
    id: 'gemini',
    name: 'Google Gemini 全系模型',
    company: 'Google (Gemini)',
    color: '#06b6d4',
    badge: 'Google',
    badgeClass: 'badge-agy'
  }, {
    id: 'deepseek',
    name: 'DeepSeek 全系模型',
    company: 'DeepSeek',
    color: '#f43f5e',
    badge: 'DeepSeek',
    badgeClass: 'badge-codex'
  }, {
    id: 'qwen',
    name: '通义千问 Qwen 全系模型',
    company: 'Qwen (通义千问)',
    color: '#ec4899',
    badge: 'Qwen',
    badgeClass: 'badge-qwen'
  }];
  const imageDays = (state.cachedData.imageAnalysis?.daily || []).filter(day => (!state.startDate || day.date >= state.startDate) && (!state.endDate || day.date <= state.endDate));
  const imageCount = imageDays.reduce((sum, day) => sum + day.count, 0);
  const families = familyDefs.map(fam => {
    let subModels = Object.values(modelMap).filter(m => m.company === fam.company);
    if (fam.id === 'openai' && ['all', 'codex'].includes(state.currentAgentFilter) && imageCount > 0) {
      subModels.push({
        modelName: `GPT-Image-2 (生图工具 · ${imageCount}张原图)`,
        cost: (state.cachedData.imageAnalysis.daily || []).filter(day => (!state.startDate || day.date >= state.startDate) && (!state.endDate || day.date <= state.endDate)).reduce((sum, day) => sum + day.cost, 0),
        tokens: 0,
        tokenEquivalent: imageDays.reduce((sum, day) => sum + day.tokens, 0),
        agent: 'codex',
        company: 'OpenAI',
        isImage: true
      });
    }
    subModels.sort((a, b) => state.currentAxisMode === 'cost' ? b.cost - a.cost : b.tokens - a.tokens);
    const totalCost = subModels.reduce((s, m) => s + (m.isImage ? 0 : m.cost), 0);
    const totalTokens = subModels.reduce((s, m) => s + m.tokens, 0);
    return {
      ...fam,
      totalCost,
      totalTokens,
      subModels
    };
  }).filter(family => family.subModels.length > 0).sort((a, b) => {
    if (a.totalTokens > 0 && b.totalTokens === 0) return -1;
    if (a.totalTokens === 0 && b.totalTokens > 0) return 1;
    return state.currentAxisMode === 'cost' ? b.totalCost - a.totalCost : b.totalTokens - a.totalTokens;
  });
  document.getElementById('models-count').innerText = `${families.length} 个模型族 · 按${state.currentAxisMode === 'cost' ? '金额' : 'Token'}`;
  if (!families.length) nextCards.push(emptyState('当前范围暂无活跃模型'));
  families.forEach(fam => {
    const domId = `fam-${fam.id}`;
    const isExpanded = state.expandedFamilies.has(domId);
    const card = document.createElement('div');
    card.className = 'family-card';
    card.dataset.key = domId;

    // Sub-models HTML
    const subRowsHtml = fam.subModels.map(m => `
      <div class="family-sub-item" data-key="${esc(m.modelName)}">
        <span class="sub-model-name">${esc(m.modelName)}${m.modelName.includes('QoderWork') ? ' <span class="est-chip" title="QoderWork 采用积分计费，本地日志 token 计数被打码，此行为正文估算值">估算</span>' : ''}</span>
        <div class="sub-model-stats font-mono">
          <span class="sub-model-cost">${m.isImage ? '文件参考 ≈' + formatUSD(m.cost) + '（不计入合计）' : m.unpriced && !m.cost ? '暂无费率' : formatUSD(m.cost)}</span>
          <span class="sub-model-tokens">${formatTokens(m.tokenEquivalent ?? m.tokens)}${m.tokenEquivalent != null ? ' 等值' : ''}</span>
        </div>
      </div>
    `).join('');
    card.innerHTML = `
      <div class="family-header" onclick="toggleFamilyExpand('${domId}', event)">
        <div class="family-info">
          <div class="family-color-bar" style="background-color: ${fam.color}"></div>
          <span class="family-name">${fam.name}</span>
          <span class="family-badge ${fam.badgeClass}">${fam.badge} (${fam.subModels.length})</span>
        </div>
        <div class="family-right">
          <div class="family-stats font-mono">
            <div class="family-cost">${state.currentAxisMode === 'cost' ? formatUSD(fam.totalCost) : formatTokens(fam.totalTokens) + ' Token'}</div>
            <div class="family-tokens">${state.currentAxisMode === 'cost' ? formatTokens(fam.totalTokens) + ' Token' : formatUSD(fam.totalCost)}</div>
          </div>
          <button class="family-expand-btn" id="btn-${domId}" aria-expanded="${isExpanded}" aria-controls="${domId}" onclick="toggleFamilyExpand('${domId}', event)">
            <span class="disclosure-label">${isExpanded ? '收起' : '展开'}</span><svg class="disclosure-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      <div class="family-sub-list ${isExpanded ? 'expanded' : ''}" id="${domId}" aria-hidden="${!isExpanded}" ${isExpanded ? '' : 'inert'}>
        ${subRowsHtml}
      </div>
    `;
    nextCards.push(card);
  });
  reconcileCards(list,nextCards);
}

// 5. Render Detail Table
function renderTable(timeline, filterKeyword = '') {
  const tbody = document.getElementById('table-body');
  const nextRows = [];
  const kw = filterKeyword.toLowerCase().trim();
  const sorted = [...timeline].filter(day => !kw || [day.date, ...Object.keys(day.byModel || {}), ...Object.keys(day.byCompany || {})].join(' ').toLowerCase().includes(kw)).sort((a, b) => state.tableSortBy === 'cost' ? b.totalCost - a.totalCost : state.tableSortBy === 'tokens' ? b.totalTokens - a.totalTokens : b.date.localeCompare(a.date));
  renderPagination('table', sorted.length, () => renderTable(getFilteredTimeline(), state.tableSearchTerm));
  const offset = (state.pagination.table.page - 1) * state.pagination.table.size;
  sorted.slice(offset, offset + state.pagination.table.size).forEach(day => {
    const modelsUsed = Object.keys(day.byModel);
    const modelsStr = modelsUsed.join(', ');
    const companiesUsed = Object.keys(day.byCompany).filter(c => day.byCompany[c].tokens > 0);
    const compStr = companiesUsed.join(', ');
    if (kw && !day.date.includes(kw) && !modelsStr.toLowerCase().includes(kw) && !compStr.toLowerCase().includes(kw)) {
      return;
    }
    const tr = document.createElement('tr');
    tr.dataset.key = day.date;
    if (day.date === state.cachedData.meta?.today) {
      tr.className = 'highlight-row';
    }
    const compPills = companiesUsed.map(c => {
      const cls = c.includes('OpenAI') ? 'pill-codex' : c.includes('智谱') ? 'pill-zcode' : c.includes('Google') ? 'pill-agy' : c.includes('Qwen') ? 'pill-qwen' : 'pill-codex';
      return `<span class="agent-pill ${cls}">${esc(c)}</span>`;
    }).join('');
    const missingPrice = Object.values(day.byModel || {}).some(model => model.unpriced || model.costComplete === false);
    const amount = missingPrice && !day.totalCost && day.totalTokens > 0 ? '未定价' : formatUSD(day.totalCost);
    tr.innerHTML = `
      <td class="font-mono"><strong>${day.date}</strong></td>
      <td>${compPills || '<span style="color:var(--text-dim)">无</span>'}</td>
      <td class="table-models" title="${esc(modelsStr)}">${esc(modelsStr)}</td>
      <td class="text-right font-mono">${formatTokens(day.totalTokens)}</td>
      <td class="text-right font-mono text-purple">${formatTokens(day.cacheReadTokens)}</td>
      <td class="text-right font-mono" title="${missingPrice ? '金额仅含已定价请求，未定价模型未计入' : 'API 等值估算'}"><strong>${amount}</strong></td>
    `;
    nextRows.push(tr);
  });
  reconcileCards(tbody,nextRows,{enter:false,exit:false});
  if (tbody.children.length === 0) {
    const row = tbody.insertRow(),
      cell = row.insertCell();
    cell.colSpan = 6;
    cell.appendChild(emptyState(kw ? '没有匹配的日期、来源或模型' : '当前区间暂无消耗记录', kw ? '清除搜索' : '查看全部日期', () => {
      state.tableSearchTerm = '';
      document.getElementById('table-search-input').value = '';
      state.pagination.table.page = 1;
      if (kw) renderTable(getFilteredTimeline());else setDatePreset('all');
    }));
  }
}
function filterTable() {
  state.tableSearchTerm = document.getElementById('table-search-input').value;
  state.pagination.table.page = 1;
  renderTable(getFilteredTimeline(), state.tableSearchTerm);
  replaceAnimation(document.getElementById('table-body'),'search',[{opacity:.4},{opacity:1}],{duration:160});
}
function sortTable(value) {
  state.tableSortBy = ['date', 'cost', 'tokens'].includes(value) ? value : 'date';
  state.pagination.table.page = 1;
  renderTable(getFilteredTimeline(), state.tableSearchTerm);
}

// User Action Controls: Date Range
function setDatePreset(preset) {
  state.pagination.table.page = 1;
  clearDateValidation();
  state.currentDatePreset = preset;
  document.querySelectorAll('.toolbar-section .btn-chip').forEach(b => {
    if (['btn-date-today', 'btn-date-milestone', 'btn-date-all', 'btn-date-30d', 'btn-date-7d'].includes(b.id)) {
      b.classList.remove('active');
    }
  });
  const allDates = (state.cachedData?.timeline || []).map(d => d.date);
  const todayStr = state.cachedData?.meta?.today || getLocalDateStr();
  const latestDate = allDates[allDates.length - 1] || todayStr;
  if (preset === 'today') {
    const btnToday = document.getElementById('btn-date-today');
    if (btnToday) btnToday.classList.add('active');
    state.startDate = todayStr;
    state.endDate = todayStr;
  } else if (preset === 'milestone') {
    document.getElementById('btn-date-milestone').classList.add('active');
    state.startDate = state.cachedData?.meta?.earliestMilestone || '2026-05-22';
    state.endDate = latestDate;
  } else if (preset === 'all') {
    document.getElementById('btn-date-all').classList.add('active');
    state.startDate = allDates[0] || '2026-05-22';
    state.endDate = latestDate;
  } else if (preset === '30d') {
    document.getElementById('btn-date-30d').classList.add('active');
    const d = new Date(`${latestDate}T12:00:00`);
    d.setDate(d.getDate() - 29);
    state.startDate = getLocalDateStr(d);
    state.endDate = latestDate;
  } else if (preset === '7d') {
    document.getElementById('btn-date-7d').classList.add('active');
    const d = new Date(`${latestDate}T12:00:00`);
    d.setDate(d.getDate() - 6);
    state.startDate = getLocalDateStr(d);
    state.endDate = latestDate;
  }
  document.getElementById('input-start-date').value = state.startDate;
  document.getElementById('input-end-date').value = state.endDate;
  renderAll();
}
function clearDateValidation() {
  for (const id of ['input-start-date', 'input-end-date']) {
    document.getElementById(id).setCustomValidity('');
    document.getElementById(id).removeAttribute('aria-invalid');
  }
  const error = document.getElementById('date-range-error');
  error.hidden = true;
  error.textContent = '';
}
function applyCustomDateRange() {
  const startInput = document.getElementById('input-start-date');
  const endInput = document.getElementById('input-end-date');
  clearDateValidation();
  const message = !startInput.value || !endInput.value ? '请选择完整的开始与结束日期' : startInput.value > endInput.value ? '开始日期不能晚于结束日期' : '';
  if (message) {
    startInput.setCustomValidity(message);
    startInput.setAttribute('aria-invalid', 'true');
    const error = document.getElementById('date-range-error');
    error.hidden = false;
    error.textContent = message;
    highlightChange(startInput,180);
    replaceAnimation(error,'validation',[{opacity:0},{opacity:1}],{duration:160});
    return;
  }
  state.startDate = startInput.value;
  state.endDate = endInput.value;
  state.pagination.table.page = 1;
  state.currentDatePreset = 'custom';
  document.querySelectorAll('.toolbar-section .btn-chip').forEach(b => {
    if (['btn-date-today', 'btn-date-milestone', 'btn-date-all', 'btn-date-30d', 'btn-date-7d'].includes(b.id)) {
      b.classList.remove('active');
    }
  });
  renderAll();
}

// User Action Controls: Y-Axis Scale & Zoom
function setYScalePreset(preset) {
  state.yScaleMode = preset;
  state.customYMax = null;
  document.getElementById('input-custom-y').value = '';
  document.getElementById('btn-scale-auto').classList.toggle('active', preset === 'auto');
  document.getElementById('btn-scale-micro').classList.toggle('active', preset === 'micro');
  document.getElementById('btn-scale-mid').classList.toggle('active', preset === 'mid');
  renderChart(getFilteredTimeline());
}
function toggleLogScale() {
  state.isLogScale = !state.isLogScale;
  document.getElementById('btn-scale-log').classList.toggle('active', state.isLogScale);
  renderChart(getFilteredTimeline());
}
function applyCustomYMax() {
  const input = document.getElementById('input-custom-y');
  const error = document.getElementById('custom-y-error');
  const val = Number(input.value);
  input.setCustomValidity('');
  input.removeAttribute('aria-invalid');
  error.hidden = true;
  if (!Number.isFinite(val) || val <= 0) {
    input.setCustomValidity('请输入大于 0 的有效上限');
    input.setAttribute('aria-invalid', 'true');
    error.textContent = '请输入大于 0 的有效上限';
    error.hidden = false;
    highlightChange(input,180);
    replaceAnimation(error,'validation',[{opacity:0},{opacity:1}],{duration:160});
    return;
  }
  if (!isNaN(val) && val > 0) {
    highlightChange(input,220);
    state.customYMax = val;
    state.yScaleMode = 'custom';
    document.getElementById('btn-scale-auto').classList.remove('active');
    document.getElementById('btn-scale-micro').classList.remove('active');
    document.getElementById('btn-scale-mid').classList.remove('active');
    renderChart(getFilteredTimeline());
  }
}
function resetZoomAndScale() {
  state.yScaleMode = 'auto';
  state.isLogScale = false;
  state.customYMax = null;
  document.getElementById('input-custom-y').value = '';
  document.getElementById('input-custom-y').setCustomValidity('');
  document.getElementById('input-custom-y').removeAttribute('aria-invalid');
  document.getElementById('custom-y-error').hidden = true;
  document.getElementById('btn-scale-auto').classList.add('active');
  document.getElementById('btn-scale-micro').classList.remove('active');
  document.getElementById('btn-scale-mid').classList.remove('active');
  document.getElementById('btn-scale-log').classList.remove('active');
  renderChart(getFilteredTimeline());
}

// Axis Dimension Switch (USD vs Tokens)
function setAxisMode(mode) {
  state.currentAxisMode = mode;
  document.getElementById('axis-cost').classList.toggle('active', mode === 'cost');
  document.getElementById('axis-tokens').classList.toggle('active', mode === 'tokens');
  renderChart(getFilteredTimeline());
  renderCompanyGrid(getFilteredTimeline());
  renderModelRanking(getFilteredTimeline());
}
export { updateChartContext, renderMetrics, getModelColor, setChartDimension, setChartSeriesLimit, renderChart, renderCompanyGrid, toggleFamilyExpand, renderModelRanking, renderTable, filterTable, sortTable, setDatePreset, clearDateValidation, applyCustomDateRange, setYScalePreset, toggleLogScale, applyCustomYMax, resetZoomAndScale, setAxisMode };
