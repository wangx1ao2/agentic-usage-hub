// Helper for dynamic local date string YYYY-MM-DD
function getLocalDateStr(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Application State
let currentPricingTier = 'standard';
let currentAgentFilter = 'all';
let currentAxisMode = 'cost'; // 'cost' | 'tokens'
let currentDatePreset = 'milestone'; // 'milestone' | 'all' | '30d' | '7d' | 'custom'
let startDate = '2026-05-22';
let endDate = null; // Dynamically resolved on load

let yScaleMode = 'auto'; // 'auto' | 'micro' | 'mid' | 'custom'
let isLogScale = false;
let customYMax = null;

let currentMainView = 'timeline'; // 'timeline' | 'projects'
let projectSearchTerm = '';
let projectAgentFilter = 'all';
let projectSortBy = 'cost'; // 'cost' | 'tokens' | 'active'
const expandedProjectDrawers = new Set();

let cachedData = null;
let chartInstance = null;

// Theme System State & Dynamic Adaptation
let currentThemeMode = localStorage.getItem('agentic_theme_mode') || 'auto';

function getEffectiveTheme() {
  if (currentThemeMode === 'light') return 'light';
  if (currentThemeMode === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(mode) {
  currentThemeMode = mode;
  try {
    localStorage.setItem('agentic_theme_mode', mode);
  } catch (e) {}

  // Update theme toggle buttons UI
  ['auto', 'light', 'dark'].forEach(m => {
    const btn = document.getElementById(`theme-btn-${m}`);
    if (btn) {
      if (m === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  const effective = getEffectiveTheme();
  document.documentElement.setAttribute('data-theme', effective);

  // If Chart.js instance is present, re-render to update gridlines and tooltips
  if (cachedData && chartInstance && currentMainView === 'timeline') {
    const filteredTimeline = getFilteredTimeline();
    renderChart(filteredTimeline);
  }
}

function setThemeMode(mode) {
  applyTheme(mode);
}

function initTheme() {
  applyTheme(currentThemeMode);

  // Auto adapt to system preference changes when in 'auto' mode
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const changeHandler = () => {
      if (currentThemeMode === 'auto') {
        applyTheme('auto');
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', changeHandler);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(changeHandler);
    }
  }
}

// Formatters
function formatTokens(tokens) {
  if (!tokens || tokens === 0) return '0';
  if (tokens >= 1e9) return (tokens / 1e9).toFixed(2) + 'B';
  if (tokens >= 1e6) return (tokens / 1e6).toFixed(1) + 'M';
  if (tokens >= 1e3) return (tokens / 1e3).toFixed(0) + 'k';
  return tokens.toLocaleString();
}

function formatUSD(cost) {
  if (cost === undefined || cost === null) return '$0.00';
  return '$' + Number(cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Fetch and load dashboard data
async function loadDashboard() {
  try {
    const res = await fetch(`/api/dashboard?tier=${currentPricingTier}&agent=${currentAgentFilter}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedData = await res.json();
    
    // Hide error banner on success
    const errBanner = document.getElementById('global-error-banner');
    if (errBanner) errBanner.style.display = 'none';

    // Update Header Last Refreshed Timestamp
    const nowStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const elHeaderLast = document.getElementById('header-last-updated');
    if (elHeaderLast) elHeaderLast.innerText = nowStr;

    // Set dynamic date range based on actual latest data
    if (cachedData.timeline && cachedData.timeline.length > 0) {
      const allDates = cachedData.timeline.map(d => d.date);
      const latestDate = allDates[allDates.length - 1];
      const todayDate = cachedData.meta?.today || getLocalDateStr();

      if (!endDate || currentDatePreset === 'milestone') {
        endDate = latestDate;
        startDate = cachedData.meta?.earliestMilestone || '2026-05-22';
      } else if (currentDatePreset === 'today') {
        startDate = todayDate;
        endDate = todayDate;
      }
      document.getElementById('input-start-date').value = startDate;
      document.getElementById('input-end-date').value = endDate;
    }

    renderAll();
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    const errBanner = document.getElementById('global-error-banner');
    const errText = document.getElementById('global-error-text');
    if (errBanner) errBanner.style.display = 'flex';
    if (errText) errText.innerText = `数据拉取失败 (${err.message})，请检查本地后台运行状态`;
    document.getElementById('last-updated').innerText = '加载失败: ' + err.message;
  }
}

// Get filtered timeline based on current date range
function getFilteredTimeline() {
  if (!cachedData || !cachedData.timeline) return [];
  return cachedData.timeline.filter(d => {
    if (startDate && d.date < startDate) return false;
    if (endDate && d.date > endDate) return false;
    return true;
  });
}

// Render everything
function renderAll() {
  if (!cachedData) return;
  const filteredTimeline = getFilteredTimeline();
  renderMetrics(filteredTimeline);
  renderChart(filteredTimeline);
  renderCompanyGrid(filteredTimeline);
  renderModelRanking(filteredTimeline);
  renderTable(filteredTimeline);

  if (cachedData.projects) {
    const badgeCount = document.getElementById('badge-projects-count');
    if (badgeCount) badgeCount.innerText = cachedData.projects.length;
    if (currentMainView === 'projects') renderProjects();
  }

  if (cachedData.imageAnalysis) {
    const totalImgs = cachedData.imageAnalysis.totals.totalCount;
    const badgeGallery = document.getElementById('badge-gallery-count');
    const chipImages = document.getElementById('chip-images-count');
    if (badgeGallery) badgeGallery.innerText = totalImgs;
    if (chipImages) chipImages.innerText = `${totalImgs} 张`;
    if (currentMainView === 'gallery') renderStudioGallery();
  }

  if (currentMainView === 'today') {
    renderTodayDashboard();
  }

  document.getElementById('last-updated').innerText = '数据已实时同步 · ' + new Date().toLocaleTimeString();
}

// 1. Render Metric Cards (4 Balanced Symmetric Cards)
function renderMetrics(timeline) {
  const { companies } = cachedData;

  const totalCost = timeline.reduce((s, d) => s + d.totalCost, 0);
  const totalTokens = timeline.reduce((s, d) => s + d.totalTokens, 0);
  const cacheTokens = timeline.reduce((s, d) => s + d.cacheReadTokens, 0);
  const cacheRate = totalTokens > 0 ? +((cacheTokens / totalTokens) * 100).toFixed(1) : 0;

  // Card 1: Total Cost
  document.getElementById('stat-total-cost').innerText = formatUSD(totalCost);
  
  // Breakdown by company in current window
  const compSpend = {};
  for (const day of timeline) {
    for (const [cName, cData] of Object.entries(day.byCompany)) {
      compSpend[cName] = (compSpend[cName] || 0) + (cData.cost || 0);
    }
  }
  const codexSpend = compSpend['OpenAI'] || 0;
  const zcodeSpend = compSpend['智谱 AI (Z.ai)'] || 0;
  const agySpend = compSpend['Google (Gemini)'] || 0;
  document.getElementById('stat-cost-breakdown').innerText = 
    `OpenAI $${codexSpend.toFixed(2)} · 智谱 $${zcodeSpend.toFixed(2)} · Gemini $${agySpend.toFixed(2)}`;

  // Card 2: Total Tokens
  const inBillion = (totalTokens / 1e8).toFixed(1);
  document.getElementById('stat-total-tokens').innerText = `${formatTokens(totalTokens)} (${inBillion}亿)`;
  document.getElementById('stat-tokens-sub').innerText = `区间共 ${timeline.length} 天消耗数据`;

  // Card 3: Cache Read
  document.getElementById('stat-cache-tokens').innerText = formatTokens(cacheTokens);
  document.getElementById('stat-cache-rate').innerText = `缓存率: ${cacheRate}% (大幅节约费用)`;

  // Card 4: Google Gemini Usage in this window
  const geminiTokens = timeline.reduce((s, d) => s + (d.byCompany['Google (Gemini)']?.tokens || 0), 0);
  const geminiCost = timeline.reduce((s, d) => s + (d.byCompany['Google (Gemini)']?.cost || 0), 0);
  const geminiDays = timeline.filter(d => (d.byCompany['Google (Gemini)']?.tokens || 0) > 0).length;

  document.getElementById('stat-gemini-usage').innerText = `${formatTokens(geminiTokens)} ($${geminiCost.toFixed(2)})`;
  document.getElementById('stat-gemini-sub').innerText = `${geminiDays}天会话实录 (Gemini 3.7 Flash)`;
}

// 2. Render Company-Level Independent Line Chart (with Zoom & Y-Scale support)
function renderChart(timeline) {
  const { companies } = cachedData;
  const ctx = document.getElementById('mainChart').getContext('2d');

  const labels = timeline.map(d => d.date.slice(5));

  // Build a dataset for EACH COMPANY (4 clean lines)
  const datasets = companies.map(company => {
    const dataPoints = timeline.map(day => {
      const compData = day.byCompany[company.name];
      if (!compData) return 0;
      const rawVal = currentAxisMode === 'cost' ? +compData.cost.toFixed(4) : compData.tokens;
      // In Log scale, non-positive values should be null or 0.001
      if (isLogScale && rawVal <= 0) return null;
      return rawVal;
    });

    return {
      label: company.label || company.name,
      companyName: company.name,
      data: dataPoints,
      borderColor: company.color,
      backgroundColor: company.color + '18',
      borderWidth: 2.8,
      pointRadius: 2.5,
      pointHoverRadius: 6,
      tension: 0.35,
      fill: false,
      spanGaps: true
    };
  });

  const isLight = getEffectiveTheme() === 'light';
  const gridColor = isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)';
  const tickColor = isLight ? '#475569' : '#64748b';

  // Calculate Y-axis limits
  let yAxisConfig = {
    type: isLogScale ? 'logarithmic' : 'linear',
    grid: {
      color: gridColor,
      drawBorder: false
    },
    ticks: {
      color: tickColor,
      font: { family: 'var(--font-mono)', size: 11 },
      callback: function(val) {
        if (currentAxisMode === 'cost') {
          return '$' + (val >= 100 ? val.toFixed(0) : val.toFixed(2));
        } else {
          return formatTokens(val);
        }
      }
    }
  };

  // Custom Max Limit
  if (customYMax !== null && customYMax > 0) {
    yAxisConfig.max = customYMax;
  } else if (yScaleMode === 'micro') {
    yAxisConfig.max = currentAxisMode === 'cost' ? 20 : 50_000_000;
  } else if (yScaleMode === 'mid') {
    yAxisConfig.max = currentAxisMode === 'cost' ? 50 : 100_000_000;
  }

  // Destroy old instance if exists
  if (chartInstance) {
    chartInstance.destroy();
  }

  // Create Chart.js instance
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(15, 18, 28, 0.95)',
          titleColor: isLight ? '#0f172a' : '#f3f4f6',
          bodyColor: isLight ? '#334155' : '#cbd5e1',
          borderColor: isLight ? 'rgba(203, 213, 225, 0.8)' : 'rgba(255, 255, 255, 0.12)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            title: function(items) {
              const idx = items[0].dataIndex;
              return `日期: ${timeline[idx]?.date}`;
            },
            label: function(context) {
              const val = context.raw;
              if (val === null || val === undefined || val === 0) return null;
              const idx = context.dataIndex;
              const companyName = context.dataset.companyName;
              const models = timeline[idx]?.byCompany[companyName]?.models || [];
              const modelHint = models.length > 0 ? ` [${models.join(', ')}]` : '';

              if (currentAxisMode === 'cost') {
                return ` ${context.dataset.label}: $${Number(val).toFixed(4)}${modelHint}`;
              } else {
                return ` ${context.dataset.label}: ${formatTokens(val)} Tokens${modelHint}`;
              }
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: gridColor,
            drawBorder: false
          },
          ticks: {
            color: tickColor,
            font: { family: 'var(--font-mono)', size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 14
          }
        },
        y: yAxisConfig
      }
    }
  });

  // Render Custom Badge Legend
  const legendContainer = document.getElementById('chart-legend');
  legendContainer.innerHTML = '';
  companies.forEach((company, idx) => {
    const badge = document.createElement('div');
    badge.className = 'legend-badge';
    badge.innerHTML = `
      <span class="legend-dot" style="background-color: ${company.color}"></span>
      <span>${company.label || company.name}</span>
    `;
    badge.onclick = () => {
      const meta = chartInstance.getDatasetMeta(idx);
      meta.hidden = meta.hidden === null ? !chartInstance.data.datasets[idx].hidden : null;
      badge.classList.toggle('disabled', meta.hidden);
      chartInstance.update();
    };
    legendContainer.appendChild(badge);
  });
}

// 3. Render Company Distribution Matrix
function renderCompanyGrid(timeline) {
  const { companies } = cachedData;
  const grid = document.getElementById('company-grid');
  grid.innerHTML = '';

  companies.forEach(comp => {
    const compCost = timeline.reduce((s, d) => s + (d.byCompany[comp.name]?.cost || 0), 0);
    const compTokens = timeline.reduce((s, d) => s + (d.byCompany[comp.name]?.tokens || 0), 0);
    const compDays = timeline.filter(d => (d.byCompany[comp.name]?.tokens || 0) > 0).length;

    const card = document.createElement('div');
    card.className = 'company-card';
    card.innerHTML = `
      <div class="company-header">
        <div class="company-color-bar" style="background-color: ${comp.color}"></div>
        <div class="company-name">${comp.label || comp.name}</div>
      </div>
      <div class="company-cost font-mono">${formatUSD(compCost)}</div>
      <div class="company-tokens font-mono">${formatTokens(compTokens)} Tokens</div>
      <div class="company-sub">区间活跃: ${compDays} 天</div>
    `;
    grid.appendChild(card);
  });
}

// State to track expanded model families
const expandedFamilies = new Set(['fam-openai']); // Default expand OpenAI/ChatGPT

function toggleFamilyExpand(familyId, event) {
  if (event) event.stopPropagation();
  const subList = document.getElementById(familyId);
  const btn = document.getElementById('btn-' + familyId);
  if (!subList) return;
  
  const isExpanded = subList.classList.toggle('expanded');
  if (isExpanded) {
    expandedFamilies.add(familyId);
    if (btn) btn.innerHTML = '收起 ▲';
  } else {
    expandedFamilies.delete(familyId);
    if (btn) btn.innerHTML = '展开 ▼';
  }
}

// 4. Render Model Ranking List (按公司大类合并 · 可点击展开明细)
function renderModelRanking(timeline) {
  const list = document.getElementById('model-rank-list');
  list.innerHTML = '';

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
          company: mData.company
        };
      }
      modelMap[mName].cost += mData.cost;
      modelMap[mName].tokens += mData.tokens;
    }
  }

  // Family definitions
  const familyDefs = [
    {
      id: 'openai',
      name: 'ChatGPT / OpenAI 全系模型',
      company: 'OpenAI',
      color: '#3b82f6',
      badge: 'OpenAI',
      badgeClass: 'badge-codex'
    },
    {
      id: 'zcode',
      name: '智谱 GLM 全系模型',
      company: '智谱 AI (Z.ai)',
      color: '#10b981',
      badge: '智谱',
      badgeClass: 'badge-zcode'
    },
    {
      id: 'gemini',
      name: 'Google Gemini 全系模型',
      company: 'Google (Gemini)',
      color: '#06b6d4',
      badge: 'Google',
      badgeClass: 'badge-agy'
    },
    {
      id: 'deepseek',
      name: 'DeepSeek 全系模型',
      company: 'DeepSeek',
      color: '#f43f5e',
      badge: 'DeepSeek',
      badgeClass: 'badge-codex'
    }
  ];

  const families = familyDefs.map(fam => {
    let subModels = Object.values(modelMap)
      .filter(m => m.company === fam.company);

    if (fam.id === 'openai' && cachedData.imageAnalysis && cachedData.imageAnalysis.totals.totalCount > 0) {
      subModels.push({
        modelName: `GPT-Image-2 (生图工具 · ${cachedData.imageAnalysis.totals.totalCount}张原图)`,
        cost: cachedData.imageAnalysis.totals.totalCost,
        tokens: cachedData.imageAnalysis.totals.totalTokens,
        agent: 'codex',
        company: 'OpenAI'
      });
    }

    subModels.sort((a, b) => b.cost - a.cost);

    const totalCost = subModels.reduce((s, m) => s + m.cost, 0);
    const totalTokens = subModels.reduce((s, m) => s + m.tokens, 0);

    return {
      ...fam,
      totalCost,
      totalTokens,
      subModels
    };
  }).filter(f => f.totalTokens > 0)
    .sort((a, b) => b.totalCost - a.totalCost);

  document.getElementById('models-count').innerText = `${families.length} 大主要模型族`;

  families.forEach(fam => {
    const domId = `fam-${fam.id}`;
    const isExpanded = expandedFamilies.has(domId);

    const card = document.createElement('div');
    card.className = 'family-card';

    // Sub-models HTML
    const subRowsHtml = fam.subModels.map(m => `
      <div class="family-sub-item">
        <span class="sub-model-name">${m.modelName}</span>
        <div class="sub-model-stats font-mono">
          <span class="sub-model-cost">${formatUSD(m.cost)}</span>
          <span class="sub-model-tokens">${formatTokens(m.tokens)}</span>
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
            <div class="family-cost">${formatUSD(fam.totalCost)}</div>
            <div class="family-tokens">${formatTokens(fam.totalTokens)} Tokens</div>
          </div>
          <button class="family-expand-btn" id="btn-${domId}" onclick="toggleFamilyExpand('${domId}', event)">
            ${isExpanded ? '收起 ▲' : '展开 ▼'}
          </button>
        </div>
      </div>
      <div class="family-sub-list ${isExpanded ? 'expanded' : ''}" id="${domId}">
        ${subRowsHtml}
      </div>
    `;
    list.appendChild(card);
  });
}

// 5. Render Detail Table
function renderTable(timeline, filterKeyword = '') {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  const kw = filterKeyword.toLowerCase().trim();
  const sorted = [...timeline].reverse();

  sorted.forEach(day => {
    const modelsUsed = Object.keys(day.byModel);
    const modelsStr = modelsUsed.join(', ');
    const companiesUsed = Object.keys(day.byCompany).filter(c => day.byCompany[c].tokens > 0);
    const compStr = companiesUsed.join(', ');

    if (kw && !day.date.includes(kw) && !modelsStr.toLowerCase().includes(kw) && !compStr.toLowerCase().includes(kw)) {
      return;
    }

    const tr = document.createElement('tr');
    if (day.date === '2026-08-30') {
      tr.className = 'highlight-row';
    }

    const compPills = companiesUsed.map(c => {
      const cls = c.includes('OpenAI') ? 'pill-codex' : c.includes('智谱') ? 'pill-zcode' : c.includes('Google') ? 'pill-agy' : 'pill-codex';
      return `<span class="agent-pill ${cls}">${c}</span>`;
    }).join('');

    tr.innerHTML = `
      <td class="font-mono"><strong>${day.date}</strong></td>
      <td>${compPills || '<span style="color:var(--text-dim)">无</span>'}</td>
      <td style="color: var(--text-muted)">${modelsStr}</td>
      <td class="text-right font-mono">${formatTokens(day.totalTokens)}</td>
      <td class="text-right font-mono" style="color: #c084fc">${formatTokens(day.cacheReadTokens)}</td>
      <td class="text-right font-mono"><strong>${formatUSD(day.totalCost)}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  if (tbody.children.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8" style="color: var(--text-dim)">当前区间没有匹配的历史消耗记录</td></tr>`;
  }
}

function filterTable() {
  const kw = document.getElementById('table-search-input').value;
  renderTable(getFilteredTimeline(), kw);
}

// User Action Controls: Date Range
function setDatePreset(preset) {
  currentDatePreset = preset;
  document.querySelectorAll('.toolbar-section .btn-chip').forEach(b => {
    if (['btn-date-today', 'btn-date-milestone', 'btn-date-all', 'btn-date-30d', 'btn-date-7d'].includes(b.id)) {
      b.classList.remove('active');
    }
  });

  const allDates = (cachedData?.timeline || []).map(d => d.date);
  const todayStr = cachedData?.meta?.today || getLocalDateStr();
  const latestDate = allDates[allDates.length - 1] || todayStr;

  if (preset === 'today') {
    const btnToday = document.getElementById('btn-date-today');
    if (btnToday) btnToday.classList.add('active');
    startDate = todayStr;
    endDate = todayStr;
  } else if (preset === 'milestone') {
    document.getElementById('btn-date-milestone').classList.add('active');
    startDate = cachedData?.meta?.earliestMilestone || '2026-05-22';
    endDate = latestDate;
  } else if (preset === 'all') {
    document.getElementById('btn-date-all').classList.add('active');
    startDate = allDates[0] || '2026-05-22';
    endDate = latestDate;
  } else if (preset === '30d') {
    document.getElementById('btn-date-30d').classList.add('active');
    const d = new Date(latestDate);
    d.setDate(d.getDate() - 30);
    startDate = getLocalDateStr(d);
    endDate = latestDate;
  } else if (preset === '7d') {
    document.getElementById('btn-date-7d').classList.add('active');
    const d = new Date(latestDate);
    d.setDate(d.getDate() - 7);
    startDate = getLocalDateStr(d);
    endDate = latestDate;
  }

  document.getElementById('input-start-date').value = startDate;
  document.getElementById('input-end-date').value = endDate;
  renderAll();
}

function applyCustomDateRange() {
  startDate = document.getElementById('input-start-date').value;
  endDate = document.getElementById('input-end-date').value;
  currentDatePreset = 'custom';
  document.querySelectorAll('.toolbar-section .btn-chip').forEach(b => {
    if (['btn-date-today', 'btn-date-milestone', 'btn-date-all', 'btn-date-30d', 'btn-date-7d'].includes(b.id)) {
      b.classList.remove('active');
    }
  });
  renderAll();
}

// User Action Controls: Y-Axis Scale & Zoom
function setYScalePreset(preset) {
  yScaleMode = preset;
  customYMax = null;
  document.getElementById('input-custom-y').value = '';

  document.getElementById('btn-scale-auto').classList.toggle('active', preset === 'auto');
  document.getElementById('btn-scale-micro').classList.toggle('active', preset === 'micro');
  document.getElementById('btn-scale-mid').classList.toggle('active', preset === 'mid');
  renderChart(getFilteredTimeline());
}

function toggleLogScale() {
  isLogScale = !isLogScale;
  document.getElementById('btn-scale-log').classList.toggle('active', isLogScale);
  renderChart(getFilteredTimeline());
}

function applyCustomYMax() {
  const val = parseFloat(document.getElementById('input-custom-y').value);
  if (!isNaN(val) && val > 0) {
    customYMax = val;
    yScaleMode = 'custom';
    document.getElementById('btn-scale-auto').classList.remove('active');
    document.getElementById('btn-scale-micro').classList.remove('active');
    document.getElementById('btn-scale-mid').classList.remove('active');
    renderChart(getFilteredTimeline());
  }
}

function resetZoomAndScale() {
  yScaleMode = 'auto';
  isLogScale = false;
  customYMax = null;
  document.getElementById('input-custom-y').value = '';
  document.getElementById('btn-scale-auto').classList.add('active');
  document.getElementById('btn-scale-micro').classList.remove('active');
  document.getElementById('btn-scale-mid').classList.remove('active');
  document.getElementById('btn-scale-log').classList.remove('active');
  renderChart(getFilteredTimeline());
}

// Axis Dimension Switch (USD vs Tokens)
function setAxisMode(mode) {
  currentAxisMode = mode;
  document.getElementById('axis-cost').classList.toggle('active', mode === 'cost');
  document.getElementById('axis-tokens').classList.toggle('active', mode === 'tokens');
  renderChart(getFilteredTimeline());
}

function setPricingTier(tier) {
  currentPricingTier = tier;
  document.getElementById('tier-standard').classList.toggle('active', tier === 'standard');
  document.getElementById('tier-flagship').classList.toggle('active', tier === 'flagship');
  loadDashboard();
}

function setAgentFilter(agent) {
  currentAgentFilter = agent;
  document.querySelectorAll('.agent-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-agent') === agent);
  });
  loadDashboard();
}

async function refreshData() {
  const btn = document.getElementById('btn-refresh');
  const text = document.getElementById('refresh-text');
  btn.classList.add('loading');
  text.innerText = '刷新中...';

  try {
    await fetch('/api/refresh');
    await loadDashboard();
  } catch (err) {
    console.error('Refresh error:', err);
  } finally {
    btn.classList.remove('loading');
    text.innerText = '刷新数据';
  }
}

// View Mode Switcher (Today vs Timeline vs Projects vs Gallery)
function switchViewMode(mode) {
  currentMainView = mode;
  const btnToday = document.getElementById('btn-view-today');
  const btnTimeline = document.getElementById('btn-view-timeline');
  const btnProjects = document.getElementById('btn-view-projects');
  const btnGallery = document.getElementById('btn-view-gallery');
  
  const viewToday = document.getElementById('view-today');
  const viewTimeline = document.getElementById('view-timeline');
  const viewProjects = document.getElementById('view-projects');
  const viewGallery = document.getElementById('view-gallery');

  // Toggle button active states
  if (btnToday) btnToday.classList.toggle('active', mode === 'today');
  if (btnTimeline) btnTimeline.classList.toggle('active', mode === 'timeline');
  if (btnProjects) btnProjects.classList.toggle('active', mode === 'projects');
  if (btnGallery) btnGallery.classList.toggle('active', mode === 'gallery');

  // Toggle view containers
  if (viewToday) viewToday.style.display = mode === 'today' ? 'block' : 'none';
  if (viewTimeline) viewTimeline.style.display = mode === 'timeline' ? 'block' : 'none';
  if (viewProjects) viewProjects.style.display = mode === 'projects' ? 'block' : 'none';
  if (viewGallery) viewGallery.style.display = mode === 'gallery' ? 'block' : 'none';

  if (mode === 'today') {
    renderTodayDashboard();
  } else if (mode === 'projects') {
    renderProjects();
  } else if (mode === 'gallery') {
    renderStudioGallery();
  }
}

// 6. Render Projects Attribution View
function renderProjects() {
  if (!cachedData || !cachedData.projects) return;

  const rawProjects = cachedData.projects;
  const kw = (projectSearchTerm || '').toLowerCase().trim();

  // 1. Filter
  let filtered = rawProjects.filter(p => {
    // Search keyword
    if (kw) {
      const matchName = p.name.toLowerCase().includes(kw);
      const matchDesc = (p.desc || '').toLowerCase().includes(kw);
      const matchPrimary = (p.primaryPath || '').toLowerCase().includes(kw);
      const matchSubPaths = (p.paths || []).some(sub => sub.toLowerCase().includes(kw));
      if (!matchName && !matchDesc && !matchPrimary && !matchSubPaths) return false;
    }
    // Agent filter
    if (projectAgentFilter !== 'all') {
      if (!p.agents.includes(projectAgentFilter)) return false;
    }
    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    if (projectSortBy === 'cost') return b.totalCost - a.totalCost;
    if (projectSortBy === 'tokens') return b.totalTokens - a.totalTokens;
    if (projectSortBy === 'active') return (b.lastActive || '').localeCompare(a.lastActive || '');
    return 0;
  });

  // 3. Update Summary Bar
  const totalCost = filtered.reduce((s, p) => s + p.totalCost, 0);
  const totalTokens = filtered.reduce((s, p) => s + p.totalTokens, 0);
  
  const elCount = document.getElementById('proj-stat-count');
  const elCost = document.getElementById('proj-stat-cost');
  const elTokens = document.getElementById('proj-stat-tokens');
  if (elCount) elCount.innerText = `${filtered.length} 个工程`;
  if (elCost) elCost.innerText = formatUSD(totalCost);
  if (elTokens) elTokens.innerText = formatTokens(totalTokens);

  // 4. Render Grid
  const grid = document.getElementById('projects-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-dim); background: var(--bg-card); border-radius: 16px; border: 1px dashed var(--border-color);">没有匹配到相关本地工程或仓库</div>`;
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'project-card';

    const isExpanded = expandedProjectDrawers.has(p.id);

    // Agent Badges
    const agentBadgesHtml = p.agents.map(ag => {
      let bClass = 'badge-codex';
      let bLabel = 'Codex';
      if (ag === 'zcode') { bClass = 'badge-zcode'; bLabel = 'ZCode'; }
      else if (ag === 'claude') { bClass = 'badge-codex'; bLabel = 'Claude Code'; }
      else if (ag === 'openclaw') { bClass = 'badge-agy'; bLabel = 'OpenClaw'; }
      return `<span class="badge-pill-agent ${bClass}">${bLabel}</span>`;
    }).join('');

    // Company segments
    const compSegsHtml = `
      <div class="project-company-seg" style="width: ${p.companies.openai.percent}%; background: #3b82f6;" title="OpenAI: ${p.companies.openai.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.zcode.percent}%; background: #10b981;" title="智谱: ${p.companies.zcode.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.deepseek.percent}%; background: #f43f5e;" title="DeepSeek: ${p.companies.deepseek.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.gemini.percent}%; background: #06b6d4;" title="Gemini: ${p.companies.gemini.percent}%"></div>
    `;

    // Sub paths html
    const pathsHtml = (p.paths || []).map(pth => `<div class="drawer-path-item">• ${pth}</div>`).join('');

    // Top models html
    const modelsHtml = (p.topModels || []).map(m => `
      <div class="drawer-model-row">
        <span class="drawer-model-name">${m.model}</span>
        <span class="drawer-model-tokens font-mono">${formatTokens(m.tokens)} Tokens</span>
      </div>
    `).join('');

    card.innerHTML = `
      <div class="project-card-header">
        <div class="project-card-icon">${p.icon || '📁'}</div>
        <div class="project-card-title-group">
          <div class="project-card-name" title="${p.name}">${p.name}</div>
          <div class="project-card-desc">${p.desc || p.primaryPath}</div>
        </div>
      </div>

      <div class="project-metrics-box">
        <div class="project-metrics-cost">
          <span class="cost-label">工程消耗金额</span>
          <span class="cost-val font-mono">${p.formattedCost}</span>
        </div>
        <div class="project-metrics-tokens font-mono">
          <div class="tok-val">${p.formattedTokens} Tokens</div>
          <div class="tok-sub">活跃时间: ${p.lastActive}</div>
        </div>
      </div>

      <div class="project-path-pill" title="${p.primaryPath}">
        <span>📁 ${p.primaryPath}</span>
        ${p.pathCount > 1 ? `<span class="path-count-badge">+${p.pathCount - 1} 子目录</span>` : ''}
      </div>

      <div class="project-company-bar" title="厂商消耗占比 (蓝色=OpenAI, 绿色=智谱, 红色=DeepSeek, 青色=Gemini)">
        ${compSegsHtml}
      </div>

      <div class="project-card-footer">
        <div class="project-agent-badges">
          ${agentBadgesHtml}
        </div>
        <button class="project-expand-btn" id="btn-expand-${p.id}" onclick="toggleProjectDrawer('${p.id}', event)">
          ${isExpanded ? '收起明细 ▲' : '展开明细 ▼'}
        </button>
      </div>

      <div class="project-details-drawer ${isExpanded ? 'expanded' : ''}" id="drawer-${p.id}">
        <div class="drawer-section-title">关联本地物理路径 (${p.paths.length})</div>
        <div class="drawer-paths-list">
          ${pathsHtml}
        </div>
        <div class="drawer-section-title" style="margin-top:10px;">核心消耗模型明细</div>
        <div class="drawer-models-list">
          ${modelsHtml || '<div style="color:var(--text-dim);font-size:11px;">无模型细分数据</div>'}
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

function filterProjects() {
  projectSearchTerm = document.getElementById('project-search-input').value;
  renderProjects();
}

function setProjectAgentFilter(agent) {
  projectAgentFilter = agent;
  document.querySelectorAll('.projects-toolbar .chip-group button[id^="proj-agent-"]').forEach(btn => {
    btn.classList.toggle('active', btn.id === `proj-agent-${agent}`);
  });
  renderProjects();
}

function setProjectSort(sort) {
  projectSortBy = sort;
  document.querySelectorAll('.projects-toolbar .chip-group button[id^="proj-sort-"]').forEach(btn => {
    btn.classList.toggle('active', btn.id === `proj-sort-${sort}`);
  });
  renderProjects();
}

function toggleProjectDrawer(id, event) {
  if (event) event.stopPropagation();
  const drawer = document.getElementById(`drawer-${id}`);
  const btn = document.getElementById(`btn-expand-${id}`);
  if (!drawer) return;

  const isExpanded = drawer.classList.toggle('expanded');
  if (isExpanded) {
    expandedProjectDrawers.add(id);
    if (btn) btn.innerText = '收起明细 ▲';
  } else {
    expandedProjectDrawers.delete(id);
    if (btn) btn.innerText = '展开明细 ▼';
  }
}

// 7. Codex Image Gallery Modal
function openImageGallery() {
  const modal = document.getElementById('image-gallery-modal');
  if (!modal || !cachedData || !cachedData.imageAnalysis) return;

  const imgData = cachedData.imageAnalysis;
  const totals = imgData.totals;

  const elCnt = document.getElementById('gal-total-count');
  const elCost = document.getElementById('gal-total-cost');
  const elTok = document.getElementById('gal-total-tokens');
  const elToday = document.getElementById('gal-today-count');

  if (elCnt) elCnt.innerText = `${totals.totalCount} 张`;
  if (elCost) elCost.innerText = totals.formattedCost;
  if (elTok) elTok.innerText = totals.formattedTokens;
  if (elToday) elToday.innerText = `${totals.todayCount} 张`;

  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const images = imgData.recentImages || [];
  images.forEach(img => {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    const imgSrc = `/api/codex-image?path=${encodeURIComponent(img.filePath)}`;
    card.innerHTML = `
      <div class="gallery-img-wrap">
        <img class="gallery-img-thumb" src="${imgSrc}" loading="lazy" alt="Codex Generated Image" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\' fill=\'%231e293b\'><text x=\'50%\' y=\'50%\' fill=\'%2364748b\' font-size=\'11\' font-weight=\'bold\' text-anchor=\'middle\' dy=\'.3em\'>图片加载中</text></svg>'">
      </div>
      <div class="gallery-card-info">
        <div class="gallery-date-badge">${img.date} · ${img.fileSize}</div>
        <div class="gallery-prompt" title="${img.prompt}">${img.prompt}</div>
      </div>
    `;
    card.onclick = () => window.open(imgSrc, '_blank');
    card.style.cursor = 'pointer';
    grid.appendChild(card);
  });

  modal.style.display = 'flex';
}

function closeImageGallery(e) {
  if (e && e.target !== document.getElementById('image-gallery-modal') && !e.target.classList.contains('modal-close-btn')) {
    return;
  }
  const modal = document.getElementById('image-gallery-modal');
  if (modal) modal.style.display = 'none';
}

// Global Escape key listener to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('image-gallery-modal');
    if (modal && modal.style.display !== 'none') {
      modal.style.display = 'none';
    }
  }
});

// 8. Studio Gallery Full View Mode
let gallerySelectedDate = 'all';
let gallerySearchQuery = '';

function renderStudioGallery() {
  if (!cachedData || !cachedData.imageAnalysis) return;

  const imgData = cachedData.imageAnalysis;
  const totals = imgData.totals;
  const daily = imgData.daily || [];
  const rawImages = imgData.recentImages || [];
  const todayStr = cachedData.meta?.today || getLocalDateStr();
  const shortToday = todayStr.slice(5);

  // 1. Update Hero Stats
  const elTotal = document.getElementById('gal-stat-total');
  const elCost = document.getElementById('gal-stat-cost');
  const elTokens = document.getElementById('gal-stat-tokens');
  const elToday = document.getElementById('gal-stat-today');

  if (elTotal) elTotal.innerText = `${totals.totalCount} 张原图`;
  if (elCost) elCost.innerText = totals.formattedCost;
  if (elTokens) elTokens.innerText = totals.formattedTokens;
  if (elToday) elToday.innerText = `${totals.todayCount} 张原图`;

  // 2. Render Fast Date Filter Chips
  const dateChipsContainer = document.getElementById('gallery-date-chips');
  if (dateChipsContainer) {
    let chipsHtml = `
      <span class="chip-label">快捷日期:</span>
      <button class="btn-chip ${gallerySelectedDate === 'all' ? 'active' : ''}" onclick="setGalleryDate('all')">全部 (${totals.totalCount})</button>
      <button class="btn-chip ${gallerySelectedDate === 'today' ? 'active' : ''}" onclick="setGalleryDate('today')">今日 ${shortToday} (${totals.todayCount})</button>
    `;
    
    // Pick top historical dates
    const topDays = [...daily].sort((a, b) => b.count - a.count).slice(0, 5);
    for (const d of topDays) {
      if (d.date !== todayStr) {
        const shortDate = d.date.slice(5);
        chipsHtml += `<button class="btn-chip ${gallerySelectedDate === d.date ? 'active' : ''}" onclick="setGalleryDate('${d.date}')">${shortDate} (${d.count}张)</button>`;
      }
    }
    dateChipsContainer.innerHTML = chipsHtml;
  }

  // 3. Filter Images
  const kw = (gallerySearchQuery || '').toLowerCase().trim();

  let filtered = rawImages.filter(img => {
    if (gallerySelectedDate === 'today' && img.date !== todayStr) return false;
    if (gallerySelectedDate !== 'all' && gallerySelectedDate !== 'today' && img.date !== gallerySelectedDate) return false;

    if (kw) {
      const matchPrompt = (img.prompt || '').toLowerCase().includes(kw);
      const matchDate = (img.date || '').includes(kw);
      const matchPath = (img.filePath || '').toLowerCase().includes(kw);
      if (!matchPrompt && !matchDate && !matchPath) return false;
    }
    return true;
  });

  // 4. Render Studio Grid
  const grid = document.getElementById('studio-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 60px; color: var(--text-dim); background: var(--bg-card); border-radius: 16px; border: 1px dashed var(--border-color);">未匹配到该筛选条件下的生图作品</div>`;
    return;
  }

  filtered.forEach(img => {
    const card = document.createElement('div');
    card.className = 'studio-card';
    const imgSrc = `/api/codex-image?path=${encodeURIComponent(img.filePath)}`;

    card.innerHTML = `
      <div class="studio-img-wrap">
        <img class="studio-img-thumb" src="${imgSrc}" loading="lazy" alt="Codex Generated Image" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\' fill=\'%23222\'><text x=\'50%\' y=\'50%\' fill=\'%23666\' text-anchor=\'middle\' dy=\'.3em\'>PNG</text></svg>'">
      </div>
      <div class="studio-card-info">
        <div class="studio-meta-row">
          <span class="studio-date-tag">📅 ${img.date}</span>
          <span class="studio-size-tag">${img.fileSize}</span>
        </div>
        <div class="studio-prompt-text" title="${img.prompt}">${img.prompt}</div>
      </div>
    `;

    card.onclick = () => window.open(imgSrc, '_blank');
    grid.appendChild(card);
  });
}

function setGalleryDate(dateKey) {
  gallerySelectedDate = dateKey;
  const container = document.getElementById('gallery-date-chips');
  if (container) {
    Array.from(container.querySelectorAll('.btn-chip')).forEach(btn => {
      const onclickAttr = btn.getAttribute('onclick') || '';
      btn.classList.toggle('active', onclickAttr.includes(`'${dateKey}'`));
    });
  }
  renderStudioGallery();
}

function filterGalleryView() {
  gallerySearchQuery = document.getElementById('gallery-search-input').value;
  renderStudioGallery();
}

// 9. Render Today's Dedicated Live Dashboard
function renderTodayDashboard() {
  if (!cachedData) return;

  const todayStr = cachedData.meta?.today || getLocalDateStr();
  const todaySummary = cachedData.todaySummary;
  const todayTimeline = todaySummary || (cachedData.timeline || []).find(d => d.date === todayStr);
  const todayImages = todaySummary?.images || (cachedData.imageAnalysis?.daily || []).find(d => d.date === todayStr) || { count: 0, cost: 0, tokens: 0 };
  
  // Update Today date badge in header
  const elDateBadge = document.getElementById('today-date-badge');
  if (elDateBadge) elDateBadge.innerText = `📅 ${todayStr} (今天)`;

  // Calculate Totals
  const mainCost = todayTimeline ? todayTimeline.totalCost : 0;
  const imgCost = todayImages.cost || 0;
  const totalCost = mainCost + imgCost;

  const mainTokens = todayTimeline ? todayTimeline.totalTokens : 0;
  const imgTokens = todayImages.tokens || 0;
  const totalTokens = mainTokens + imgTokens;

  const cacheTokens = todayTimeline ? todayTimeline.cacheReadTokens : 0;
  const cacheRate = mainTokens > 0 ? +((cacheTokens / mainTokens) * 100).toFixed(1) : 0;

  // 1. Fill 4 Key Metric Cards
  const elCost = document.getElementById('today-stat-cost');
  const elCostSub = document.getElementById('today-stat-cost-sub');
  if (elCost) elCost.innerText = formatUSD(totalCost);
  if (elCostSub) elCostSub.innerText = `主模型 ${formatUSD(mainCost)} · 生图 ${formatUSD(imgCost)}`;

  const elTokens = document.getElementById('today-stat-tokens');
  const elTokensSub = document.getElementById('today-stat-tokens-sub');
  if (elTokens) elTokens.innerText = `${formatTokens(totalTokens)} (${(totalTokens / 1e6).toFixed(1)}M)`;
  if (elTokensSub) elTokensSub.innerText = `含缓存读取 ${formatTokens(cacheTokens)}`;

  const elCache = document.getElementById('today-stat-cache');
  const elCacheSub = document.getElementById('today-stat-cache-sub');
  if (elCache) elCache.innerText = formatTokens(cacheTokens);
  if (elCacheSub) elCacheSub.innerText = `缓存命中率: ${cacheRate}% (大幅降低开销)`;

  const elImages = document.getElementById('today-stat-images');
  const elImagesSub = document.getElementById('today-stat-images-sub');
  if (elImages) elImages.innerText = `${todayImages.count} 张原图`;
  if (elImagesSub) elImagesSub.innerText = `折合 ${formatUSD(imgCost)} · ${formatTokens(imgTokens)} Tokens`;

  // 2. Models Breakdown & Proportional Bar
  const modelsList = [];
  if (todayTimeline && todayTimeline.byModel) {
    for (const [mName, mData] of Object.entries(todayTimeline.byModel)) {
      let color = '#3b82f6';
      if (mData.company === 'Google (Gemini)') color = '#06b6d4';
      else if (mData.company === '智谱 AI (Z.ai)') color = '#10b981';
      else if (mData.company === 'DeepSeek') color = '#f43f5e';
      else if (mData.company === 'Anthropic') color = '#d97706';
      else if (mData.company === 'xAI') color = '#8b5cf6';
      else if (mData.company === 'Qwen (通义千问)') color = '#ec4899';
      else if (mData.company === 'OpenAI') color = '#3b82f6';
      else {
        const found = (cachedData?.companies || []).find(c => c.name === mData.company);
        if (found && found.color) color = found.color;
      }

      modelsList.push({
        name: mName,
        company: mData.company,
        cost: mData.cost,
        tokens: mData.tokens,
        color: color
      });
    }
  }
  if (todayImages.count > 0) {
    modelsList.push({
      name: `GPT-Image-2 (生图工具 · ${todayImages.count}张)`,
      company: 'OpenAI (图像生成)',
      cost: imgCost,
      tokens: imgTokens,
      color: '#ec4899'
    });
  }
  modelsList.sort((a, b) => b.cost - a.cost);

  // Render proportional bar
  const barContainer = document.getElementById('today-proportional-bar');
  if (barContainer) {
    let barHtml = '';
    modelsList.forEach(m => {
      const pct = totalCost > 0 ? +((m.cost / totalCost) * 100).toFixed(1) : 0;
      if (pct > 0) {
        barHtml += `<div class="today-bar-seg" style="width: ${pct}%; background: ${m.color};" title="${m.name}: ${pct}% (${formatUSD(m.cost)})"></div>`;
      }
    });
    barContainer.innerHTML = barHtml;
  }

  // Render models list
  const listContainer = document.getElementById('today-models-list');
  if (listContainer) {
    let listHtml = '';
    modelsList.forEach(m => {
      const pct = totalCost > 0 ? +((m.cost / totalCost) * 100).toFixed(1) : 0;
      listHtml += `
        <div class="today-model-item">
          <div class="today-model-left">
            <span class="today-model-dot" style="background: ${m.color};"></span>
            <div>
              <div class="today-model-name">${m.name}</div>
              <div class="today-model-company">${m.company} · 占比 ${pct}%</div>
            </div>
          </div>
          <div class="today-model-stats">
            <span class="today-model-cost font-mono">${formatUSD(m.cost)}</span>
            <span class="today-model-tokens font-mono">${formatTokens(m.tokens)} Tokens</span>
          </div>
        </div>
      `;
    });
    listContainer.innerHTML = listHtml;
  }

  // 3. Render Active Workspaces
  const activeProjects = (cachedData.projects || []).filter(p => p.lastActive === todayStr);
  const wsContainer = document.getElementById('today-workspaces-section');
  if (wsContainer) {
    if (activeProjects.length === 0) {
      wsContainer.innerHTML = `<div style="color:var(--text-dim);font-size:12px;padding:12px;text-align:center;">今日主要进行独立命令行即时调试与图像生成任务</div>`;
    } else {
      let wsHtml = '';
      activeProjects.forEach(p => {
        wsHtml += `
          <div class="today-workspace-card">
            <div class="today-ws-icon">${p.icon || '💼'}</div>
            <div class="today-ws-info">
              <div class="today-ws-name">${p.name}</div>
              <div class="today-ws-meta">${p.primaryPath} · 累计消耗 ${p.formattedCost}</div>
            </div>
          </div>
        `;
      });
      wsContainer.innerHTML = wsHtml;
    }
  }

  // 4. Render Today Image Strip (Latest 8 images)
  const stripContainer = document.getElementById('today-image-strip');
  if (stripContainer && cachedData.imageAnalysis?.recentImages) {
    const todayImgs = cachedData.imageAnalysis.recentImages.filter(img => img.date === todayStr).slice(0, 8);
    let stripHtml = '';
    todayImgs.forEach(img => {
      const imgSrc = `/api/codex-image?path=${encodeURIComponent(img.filePath)}`;
      stripHtml += `
        <div class="today-strip-thumb" onclick="window.open('${imgSrc}', '_blank')" title="${img.prompt || 'Codex 生图'} (${img.fileSize})">
          <img src="${imgSrc}" loading="lazy" alt="Generated thumbnail" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\' fill=\'%231e293b\'><text x=\'50%\' y=\'50%\' fill=\'%2364748b\' font-size=\'11\' font-weight=\'bold\' text-anchor=\'middle\' dy=\'.3em\'>图</text></svg>'">
        </div>
      `;
    });
    stripContainer.innerHTML = stripHtml || '<div style="color:var(--text-dim);font-size:11px;">今日无新生成图像</div>';
  }
}

// ── Model Pricing Matrix Modal Logic ───────────
let cachedPricingMatrix = null;

async function togglePricingModal() {
  const modal = document.getElementById('pricing-modal');
  if (!modal) return;
  const isHidden = modal.style.display === 'none' || !modal.style.display;
  if (isHidden) {
    modal.style.display = 'flex';
    if (!cachedPricingMatrix) {
      await loadPricingMatrix();
    }
  } else {
    modal.style.display = 'none';
  }
}

async function loadPricingMatrix() {
  const tbody = document.getElementById('pricing-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">正在加载官方计费矩阵...</td></tr>';
  try {
    const res = await fetch('/api/models-pricing');
    const data = await res.json();
    cachedPricingMatrix = data;
    renderPricingTable(data.models, data.companies);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:#f43f5e">获取价目表失败: ${err.message}</td></tr>`;
  }
}

function renderPricingTable(models, companies) {
  const tbody = document.getElementById('pricing-table-body');
  if (!tbody) return;

  const entries = Object.entries(models || {});
  let html = '';
  for (const [mKey, mVal] of entries) {
    const compConf = (companies && companies[mVal.company]) || { color: '#94a3b8', badgeClass: 'badge-other' };
    const std = mVal.standard || {};
    html += `
      <tr class="pricing-row" data-search="${mKey} ${mVal.label || ''} ${mVal.company || ''}">
        <td>
          <span class="pricing-provider-tag ${compConf.badgeClass || ''}">${mVal.company}</span>
        </td>
        <td>
          <strong style="color:var(--text-main)">${mVal.label || mKey}</strong>
          <div style="font-size:11px;color:var(--text-dim);font-family:monospace">${mKey}</div>
        </td>
        <td class="font-mono text-emerald">$${Number(std.in || 0).toFixed(2)}</td>
        <td class="font-mono text-blue">$${Number(std.out || 0).toFixed(2)}</td>
        <td class="font-mono text-purple">$${Number(std.cache || 0).toFixed(3)}</td>
        <td>
          <span style="font-size:12px;color:var(--text-muted)">${mVal.agent || 'cli'}</span>
        </td>
      </tr>
    `;
  }
  tbody.innerHTML = html;
}

function filterPricingTable() {
  const query = (document.getElementById('pricing-search-input')?.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('.pricing-row');
  rows.forEach(r => {
    const s = r.getAttribute('data-search').toLowerCase();
    r.style.display = (!query || s.includes(query)) ? '' : 'none';
  });
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadDashboard();
});

