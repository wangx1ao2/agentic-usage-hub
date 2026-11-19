import { disposeMotion, feedbackButton, getMotionPolicy, replaceAnimation, revealGroup, setText } from './motion.js';
import { requestJSON, queryString } from './api.js';
import { initInsights, renderInsights } from './insights.js';
import './codex-live.js';
import { state } from './state.js';
import { animateView, debounce, setDataStatus, syncViewTabs } from './experience.js';
import { animateDisclosure, calendarTimeline, compactDisplayPath, emptyState, esc, formatTokens, formatUSD, getLocalDateStr, reconcileCards, renderPagination, renderSparkline } from './utils.js';
import { applyCustomDateRange, applyCustomYMax, clearDateValidation, filterTable, getModelColor, renderChart, renderCompanyGrid, renderMetrics, renderModelRanking, renderTable, resetZoomAndScale, setAxisMode, setChartDimension, setChartSeriesLimit, setDatePreset, setYScalePreset, sortTable, toggleFamilyExpand, toggleLogScale, updateChartContext } from './timeline.js';
import { copyProjectPath, filterProjects, renderProjects, setProjectAgentFilter, setProjectSort, showTodayProjects, toggleProjectDrawer, toggleProjectTodayOnly } from './projects.js';
import { showTodayGallery, closeImageGallery, filterGalleryView, handleThumbnailError, handleThumbnailLoad, loadGalleryCatalog, openImageGallery, renderStudioGallery, setGalleryDate, setGalleryFit } from './gallery.js';
import { renderQuotaHistory, renderTodayDashboard, selectQuotaDate, setQuotaHistoryRange } from './today.js';
import { applyTheme, getEffectiveTheme, initTheme, setThemeMode } from './theme.js';
import { getCurrentActivePlan, getSubscriptionSettings, matchesPlanScope, onSubscriptionPlanChange, renderSubscriptionROI, saveCustomSubscription, saveSubscriptionSettings, toggleCustomSubModal } from './subscription.js';
import { filterPricingTable, loadPricingMatrix, renderPricingTable, togglePricingModal } from './pricing.js';
try {
  state.currentThemeMode = localStorage.getItem('agentic_theme_mode') || 'auto';
} catch (e) {}
try {
  if (localStorage.getItem('agentic_gallery_fit') === 'cover') state.galleryFitMode = 'cover';
} catch (e) {}
function showErrorBanner(message) {
  const banner = document.getElementById('global-error-banner');
  const entering = banner.style.display === 'none';
  document.getElementById('global-error-text').textContent = message;
  banner.style.display = 'flex';
  if (entering) replaceAnimation(banner,'error-banner',[
    {height:'0px',opacity:0},{height:`${banner.getBoundingClientRect().height}px`,opacity:1}
  ],{duration:200});
}
// Fetch and load dashboard data
let dashboardPollTimer;
function scheduleDashboardRead(delay = 60000) {
  clearTimeout(dashboardPollTimer);
  dashboardPollTimer = setTimeout(() => {
    if (document.hidden || state.refreshInFlight || state.dashboardRequest) scheduleDashboardRead(delay);
    else void loadDashboard();
  }, delay);
}

async function loadDashboard() {
  clearTimeout(dashboardPollTimer);
  const epoch = ++state.requestEpoch;
  state.dashboardRequest?.abort();
  const controller = new AbortController();
  state.dashboardRequest = controller;
  const firstLoad = !state.cachedData;
  document.body.classList.toggle('is-initial-loading', firstLoad);
  document.getElementById(`view-${state.currentMainView}`)?.setAttribute('aria-busy', 'true');
  setDataStatus(firstLoad ? 'loading' : 'refreshing', firstLoad ? '正在读取本地日志…' : '正在更新，保留上次成功数据…');
  try {
    const nextData = await requestJSON(`/api/dashboard?${queryString({tier:state.currentPricingTier, agent:state.currentAgentFilter, actualOnly:state.actualOnly,
      pricingMode:state.pricingMode, pricingVersion:state.pricingVersion})}`, {
      signal: controller.signal
    });
    if (epoch !== state.requestEpoch) return false;
    state.cachedData = nextData;
    state.galleryCatalogEpoch++;
    state.galleryCatalog = null;
    state.galleryCatalogError = '';
    state.galleryCatalogRequest?.abort();
    state.galleryCatalogRequest = null;
    state.lastSuccessfulFetch = Date.parse(state.cachedData.meta?.lastSuccessfulAt || state.cachedData.meta?.generatedAt) || Date.now();
    const costNotice = document.getElementById('cost-notice');
    if (costNotice) {
      const sourceMode = state.cachedData.meta?.sourceSelectionMode;
      const fallback = sourceMode === 'codex-only-fallback' ? 'ccusage 按来源明细暂不可用，目前仅纳入其 Codex 数据。' : sourceMode === 'pending' ? 'ccusage 数据仍在加载或暂不可用。' : '';
      costNotice.innerText = [state.cachedData.meta?.costNotice, fallback].filter(Boolean).join(' ');
    }

    // Hide error banner on success
    const errBanner = document.getElementById('global-error-banner');
    if (errBanner) errBanner.style.display = 'none';

    // Update Header Last Refreshed Timestamp
    const nowStr = new Date(state.lastSuccessfulFetch).toLocaleTimeString('zh-CN', {
      hour12: false
    });
    const elHeaderLast = document.getElementById('header-last-updated');
    if (elHeaderLast) elHeaderLast.innerText = nowStr;

    // Set dynamic date range based on actual latest data
    if (state.cachedData.timeline && state.cachedData.timeline.length > 0) {
      const allDates = state.cachedData.timeline.map(d => d.date);
      const latestDate = allDates[allDates.length - 1];
      const todayDate = state.cachedData.meta?.today || getLocalDateStr();
      if (state.currentDatePreset === 'milestone') {
        state.endDate = latestDate;
        state.startDate = state.cachedData.meta?.earliestMilestone || allDates[0];
      } else if (state.currentDatePreset === '30d' || state.currentDatePreset === '7d') {
        const date = new Date(`${latestDate}T12:00:00`);
        date.setDate(date.getDate() - (state.currentDatePreset === '30d' ? 29 : 6));
        state.startDate = getLocalDateStr(date);
        state.endDate = latestDate;
      } else if (state.currentDatePreset === 'all') {
        state.startDate = allDates[0];
        state.endDate = latestDate;
      } else if (state.currentDatePreset === 'today') {
        state.startDate = todayDate;
        state.endDate = todayDate;
      }
      document.getElementById('input-start-date').value = state.startDate;
      document.getElementById('input-end-date').value = state.endDate;
    }
    renderAll();
    if (firstLoad) animateView(document.getElementById(`view-${state.currentMainView}`));
    const pending = state.cachedData.meta?.sourceSelectionMode === 'pending';
    const stale = pending || !!state.cachedData.meta?.stale;
    const coverage = state.cachedData.meta?.recordCoverage?.to;
    setDataStatus(stale ? 'stale' : 'fresh', `${pending ? '历史用量仍在加载，当前合计暂不完整，将自动更新' : stale ? '显示上次成功数据' : '读取成功'} · ${nowStr}${coverage ? ` · 日志覆盖至 ${coverage}` : ''}`);
    return true;
  } catch (err) {
    if (err.name === 'AbortError' || epoch !== state.requestEpoch) return false;
    console.error('Failed to load dashboard:', err);
    showErrorBanner(`读取失败 (${err.message})${state.cachedData ? '，正在显示上次成功数据' : '，请检查本地服务'}`);
    setDataStatus('error', state.cachedData ? '连接失败 · 显示上次成功数据' : '读取失败 · 可点击重试');
    return false;
  } finally {
    if (epoch === state.requestEpoch) {
      document.body.classList.remove('is-initial-loading');
      document.querySelectorAll('.view-content').forEach(el => el.setAttribute('aria-busy', 'false'));
      state.dashboardRequest = null;
      const meta = state.cachedData?.meta;
      scheduleDashboardRead(meta?.refreshing || meta?.sourceSelectionMode === 'pending' || !state.cachedData ? 2000 : 60000);
    }
  }
}

// Get filtered timeline based on current date range
function getFilteredTimeline() {
  if (!state.cachedData || !state.cachedData.timeline) return [];
  return state.cachedData.timeline.filter(d => {
    if (state.startDate && d.date < state.startDate) return false;
    if (state.endDate && d.date > state.endDate) return false;
    return true;
  });
}

// Render everything
function renderAll() {
  if (!state.cachedData) return;
  document.querySelectorAll('button[id^="btn-date-"]').forEach(button => {
    const selected = button.id === `btn-date-${state.currentDatePreset}`;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('.btn-toggle,.agent-tab,.btn-axis,.btn-chip').forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
  const filteredTimeline = getFilteredTimeline();
  if (state.currentMainView === 'timeline') {
    renderMetrics(filteredTimeline);
    renderChart(filteredTimeline);
    renderCompanyGrid(filteredTimeline);
    renderModelRanking(filteredTimeline);
    renderTable(filteredTimeline, state.tableSearchTerm);
  }
  if (state.cachedData.projects) {
    const badgeCount = document.getElementById('badge-projects-count');
    if (badgeCount) setText(badgeCount, state.cachedData.projects.length);
    if (state.currentMainView === 'projects') renderProjects();
  }
  if (state.cachedData.imageAnalysis) {
    const totalImgs = state.cachedData.imageAnalysis.totals.totalCount;
    const badgeGallery = document.getElementById('badge-gallery-count');
    const chipImages = document.getElementById('chip-images-count');
    if (badgeGallery) setText(badgeGallery,totalImgs);
    if (chipImages) chipImages.innerText = `${totalImgs} 张`;
    if (state.currentMainView === 'gallery') renderStudioGallery();
  }
  if (state.currentMainView === 'today') {
    renderTodayDashboard();
  }
  syncViewTabs(state.currentMainView);
  renderInsights();
  revealGroup(document.getElementById(`view-${state.currentMainView}`));
}

// 1. Render Metric Cards (4 Balanced Symmetric Cards)

function setPricingTier(tier) {
  state.currentPricingTier = tier;
  document.getElementById('tier-standard').classList.toggle('active', tier === 'standard');
  document.getElementById('tier-flagship').classList.toggle('active', tier === 'flagship');
  setText('pricing-basis','正在按所选费率重算…');
  loadDashboard();
}
function setAgentFilter(agent) {
  state.currentAgentFilter = agent;
  document.querySelectorAll('.agent-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-agent') === agent);
  });
  const selected = document.querySelector(`.agent-tab[data-agent="${agent}"]`);
  if (selected) {
    const parent = selected.parentElement, rect = selected.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
    if (rect.left < bounds.left || rect.right > bounds.right) parent.scrollTo({left:parent.scrollLeft + rect.left - bounds.left - 8,behavior:getMotionPolicy().enabled ? 'smooth' : 'auto'});
  }
  setText('estimate-summary','正在按所选来源筛选…');
  loadDashboard();
}
async function refreshData() {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  const btn = document.getElementById('btn-refresh');
  const text = document.getElementById('refresh-text');
  btn.classList.add('loading');
  const buttons = document.querySelectorAll('button[onclick="refreshData()"]');
  buttons.forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('loading');
  });
  setDataStatus('refreshing', '正在刷新，保留上次成功数据…');
  text.innerText = '刷新中...';
  try {
    const report = await requestJSON('/api/refresh', { timeoutMs: 240000 });
    const loaded = await loadDashboard();
    if (loaded && report.success !== false) buttons.forEach(button => feedbackButton(button));
    if (report.success === false) {
      const failed = (report.sources || []).filter(source => !source.success).map(source => source.source).join('、');
      setDataStatus('stale', `部分来源刷新失败：${failed} · 保留该来源上次成功数据`);
      showErrorBanner(`部分来源刷新失败：${failed}，请查看来源状态后重试`);
    }
  } catch (err) {
    console.error('Refresh error:', err);
    setDataStatus('error', state.cachedData ? '刷新失败 · 显示上次成功数据' : '刷新失败 · 请重试');
    showErrorBanner(`刷新失败 (${err.message})${state.cachedData ? '，保留上次成功数据' : ''}`);
  } finally {
    btn.classList.remove('loading');
    text.innerText = '刷新数据';
    buttons.forEach(button => {
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
      button.classList.remove('loading');
    });
    state.refreshInFlight = false;
  }
}

// View Mode Switcher (Today vs Timeline vs Projects vs Gallery)
function switchViewMode(mode) {
  if (!['today', 'live', 'timeline', 'projects', 'gallery'].includes(mode)) return;
  const previous = state.currentMainView;
  const order = ['today','live','timeline','projects','gallery'];
  const direction = Math.sign(order.indexOf(mode)-order.indexOf(previous));
  const changed = mode !== previous;
  if (changed) disposeMotion(document.getElementById(`view-${previous}`));
  state.currentMainView = mode;
  const btnToday = document.getElementById('btn-view-today');
  const btnLive = document.getElementById('btn-view-live');
  const btnTimeline = document.getElementById('btn-view-timeline');
  const btnProjects = document.getElementById('btn-view-projects');
  const btnGallery = document.getElementById('btn-view-gallery');
  const viewToday = document.getElementById('view-today');
  const viewLive = document.getElementById('view-live');
  const viewTimeline = document.getElementById('view-timeline');
  const viewProjects = document.getElementById('view-projects');
  const viewGallery = document.getElementById('view-gallery');

  // Toggle button active states
  if (btnToday) btnToday.classList.toggle('active', mode === 'today');
  if (btnLive) btnLive.classList.toggle('active', mode === 'live');
  if (btnTimeline) btnTimeline.classList.toggle('active', mode === 'timeline');
  if (btnProjects) btnProjects.classList.toggle('active', mode === 'projects');
  if (btnGallery) btnGallery.classList.toggle('active', mode === 'gallery');

  // Toggle view containers
  if (viewToday) viewToday.style.display = mode === 'today' ? 'block' : 'none';
  if (viewLive) viewLive.style.display = mode === 'live' ? 'block' : 'none';
  if (viewTimeline) viewTimeline.style.display = mode === 'timeline' ? 'block' : 'none';
  if (viewProjects) viewProjects.style.display = mode === 'projects' ? 'block' : 'none';
  if (viewGallery) viewGallery.style.display = mode === 'gallery' ? 'block' : 'none';
  window.codexLive?.sync();
  renderAll();
  syncViewTabs(mode);
  if (mode === 'timeline') state.chartInstance?.resize();
  if (changed) animateView(document.getElementById(`view-${mode}`),{direction});
}

// 6. Render Projects Attribution View

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initInsights();
  loadDashboard();
});
function markDataStale() {
  if (!document.hidden && state.lastSuccessfulFetch && Date.now() - state.lastSuccessfulFetch >= 300000 && document.body.dataset.dataState === 'fresh') {
    setDataStatus('stale', '已超过 5 分钟未刷新 · 显示上次成功数据');
  }
}
setInterval(markDataStale, 60000);
document.addEventListener('visibilitychange', () => {
  markDataStale();
  if (!document.hidden && !state.dashboardRequest && !state.refreshInFlight) void loadDashboard();
});
document.addEventListener('motionpolicychange', () => {
  if (state.currentMainView === 'timeline' && state.cachedData) renderChart(getFilteredTimeline(), false);
});

// ──────────────────────────────────────────────────────────
// 10. Subscription ROI & Quota Utilization (启发一: 订阅制专属回本率与配额监控)
// ──────────────────────────────────────────────────────────

// Attach functions to window for onclick/onchange handlers
window.onSubscriptionPlanChange = onSubscriptionPlanChange;
window.toggleCustomSubModal = toggleCustomSubModal;
window.saveCustomSubscription = saveCustomSubscription;
window.renderSubscriptionROI = renderSubscriptionROI;
Object.assign(window, {
  getLocalDateStr,
  compactDisplayPath,
  calendarTimeline,
  renderSparkline,
  updateChartContext,
  renderPagination,
  emptyState,
  reconcileCards,
  getEffectiveTheme,
  applyTheme,
  setThemeMode,
  initTheme,
  formatTokens,
  formatUSD,
  esc,
  loadDashboard,
  getFilteredTimeline,
  renderAll,
  renderMetrics,
  getModelColor,
  setChartDimension,
  setChartSeriesLimit,
  renderChart,
  renderCompanyGrid,
  toggleFamilyExpand,
  renderModelRanking,
  renderTable,
  filterTable,
  sortTable,
  setDatePreset,
  clearDateValidation,
  applyCustomDateRange,
  setYScalePreset,
  toggleLogScale,
  applyCustomYMax,
  resetZoomAndScale,
  setAxisMode,
  setPricingTier,
  setAgentFilter,
  refreshData,
  switchViewMode,
  renderProjects,
  filterProjects,
  toggleProjectTodayOnly,
  showTodayProjects,
  copyProjectPath,
  setProjectAgentFilter,
  setProjectSort,
  toggleProjectDrawer,
  animateDisclosure,
  handleThumbnailError,
  handleThumbnailLoad,
  openImageGallery,
  closeImageGallery,
  renderStudioGallery,
  setGalleryFit,
  loadGalleryCatalog,
  setGalleryDate,
  showTodayGallery,
  filterGalleryView,
  selectQuotaDate,
  setQuotaHistoryRange,
  renderQuotaHistory,
  renderTodayDashboard,
  togglePricingModal,
  loadPricingMatrix,
  renderPricingTable,
  filterPricingTable,
  markDataStale,
  getSubscriptionSettings,
  saveSubscriptionSettings,
  getCurrentActivePlan,
  matchesPlanScope,
  renderSubscriptionROI,
  onSubscriptionPlanChange,
  toggleCustomSubModal,
  saveCustomSubscription
});
Object.defineProperty(window, 'appState', {
  value: state
});
window.filterTable = debounce(filterTable, 160);
window.filterProjects = debounce(filterProjects, 160);
window.filterGalleryView = debounce(filterGalleryView, 160);
export { loadDashboard, getFilteredTimeline, renderAll, setPricingTier, setAgentFilter, refreshData, switchViewMode, markDataStale };
