import { highlightChange, replaceAnimation, setText as updateText } from './motion.js';
import { state } from './state.js';
import { reconcileMarkup, compactDisplayPath, esc, formatTokens, formatUSD, getLocalDateStr } from './utils.js';
import { animateValue, openLightbox } from './experience.js';
import { renderSubscriptionROI } from './subscription.js';
import { showTodayProjects } from './projects.js';
const knownTodayImages = new Set();
let imageStripInitialized = false;
function selectQuotaDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  state.selectedQuotaDate = date;
  renderQuotaHistory();
}
function setQuotaHistoryRange(range) {
  state.quotaHistoryRange = ['7', '30', 'all'].includes(range) ? range : '7';
  renderQuotaHistory();
  replaceAnimation(document.getElementById('quota-daily-rows'),'range',[{opacity:.4},{opacity:1}],{duration:180});
}
function renderQuotaHistory() {
  const windowBody = document.getElementById('quota-window-rows');
  const dailyBody = document.getElementById('quota-daily-rows');
  if (!state.cachedData || !windowBody || !dailyBody) return;
  const history = state.cachedData.codexQuota || state.cachedData.todaySummary?.codexQuota;
  const daily = history?.daily || [];
  const today = state.cachedData.meta?.today || getLocalDateStr();
  const date = state.selectedQuotaDate || today;
  const day = daily.find(row => row.date === date);
  const dateInput = document.getElementById('quota-history-date');
  document.getElementById('quota-history-range').value = state.quotaHistoryRange;
  dateInput.value = date;
  dateInput.max = today;
  if (daily.length) dateInput.min = daily[0].date;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) updateText(el,text);
  };
  const percent = row => row?.usedPercent == null || row.quotaObserved === false ? '未记录' : `${row.usageIsLowerBound ? '≥' : ''}${Number(row.usedPercent.toFixed(2))}%`;
  const units = row => row?.quotaUnits == null ? '--' : `${row.usageIsLowerBound ? '≥' : ''}${row.quotaUnits.toFixed(2)} 份`;
  const money = value => value == null ? '--' : `≈${formatUSD(value)}`;
  const subtotal = row => row?.costComplete === false && !row.apiEquivalentUSD ? '暂无费率' : money(row?.apiEquivalentUSD);
  setText('quota-day-units', units(day));
  setText('quota-day-percent', day ? `${percent(day)} · ${day.completedWindowCount} 个窗口记录到用满` : '这一天暂无额度日志');
  setText('quota-day-cost', subtotal(day));
  setText('quota-day-cost-note', '含 Codex 会话与订阅桥接 API，图像工具费用未记录'
    + (state.cachedData.meta?.autoReviewNotice ? ' · ' + state.cachedData.meta.autoReviewNotice : '')
    + (day?.incompleteRequests ? ` · ${day.incompleteRequests} 次请求金额不完整，仅含已定价部分`
      : day?.unpricedRequests ? ` · ${day.unpricedRequests} 次未定价请求未计入` : ' · 含用满后的续跑'));
  setText('quota-day-average', money(day?.averagePer100USD));
  setText('quota-day-average-note', day?.comparableUsedPercent > 0 ? `按 ${Number(day.comparableUsedPercent.toFixed(2))}% 可对齐的额度增长估算${day.estimateLowSample ? ' · 样本较小，波动大' : ''}` : '额度与金额记录不足，暂不推算');
  setText('quota-window-caption', `${date} · 每个五小时窗口`);
  const timezone = history?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = timestamp => new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone
  }).format(new Date(timestamp));
  const time = timestamp => new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: timezone,
    ...(localDate(timestamp) === date ? {} : {
      month: '2-digit',
      day: '2-digit'
    }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const previousWindows = new Map([...windowBody.rows].map(row=>[row.dataset.key,row.querySelector('.quota-basis')?.textContent]));
  const windowsMarkup = day?.windows.length ? day.windows.map(row => {
    const basis = row.estimateBasis === 'confirmed100' ? '用户确认用满' : row.estimateBasis === 'recorded100' ? '用满记录' : row.estimateBasis === 'linear-incomplete100' ? '用满 · 部分日志推算' : row.estimateBasis === 'linear' ? row.estimateLowSample ? '小样本推算' : '部分使用推算' : '记录不足';
    const basisNote = row.completionSource === 'user-confirmed' ? '历史校正 · 首次用满时间未知' : row.estimateBasis === 'recorded100' ? `首次用满 ${time(row.reached100At)}` : row.estimateBasis.startsWith('linear') ? `按 ${Number(row.comparisonUsedPercent.toFixed(2))}% 增长推算` : '未观察到可对齐的额度增长';
    const apiNote = row.subscriptionApiRequests ? `<small>含 ${row.subscriptionApiRequests} 次订阅桥接 API · ${money(row.subscriptionApiEquivalentUSD)}</small>` : '';
    const endsAt = row.displayEndsAt ?? row.resetsAt;
    const transitionNote = endsAt < row.resetsAt ? `<small>下一窗口开始 · 原定 ${esc(time(row.resetsAt))} 重置</small>` : '';
    return `<tr data-key="${esc(date+':'+row.startsAt)}"><td><span class="font-mono">${esc(time(row.startsAt))}–${esc(time(endsAt))}</span>${transitionNote}${row.startCovered ? '' : '<small>窗口开头记录不完整</small>'}</td>
      <td><strong class="font-mono">${percent(row)}</strong><div class="quota-window-meter"><span style="width:${Math.min(100, Math.max(0, row.usedPercent))}%"></span></div></td>
      <td class="font-mono">${subtotal(row)}${row.costComplete === false ? '<small>仅已定价部分</small>' : ''}${apiNote}</td><td class="font-mono">${money(row.estimatedPer100USD)}</td>
      <td><span class="quota-basis ${['recorded100', 'confirmed100'].includes(row.estimateBasis) ? 'quota-basis-full' : ''}">${basis}</span><small>${esc(basisNote)}</small></td></tr>`;
  }).join('') : `<tr><td colspan="5" class="quota-empty">${history?.schemaVersion === 2 ? '这一天没有可核对的五小时窗口。' : '正在读取本机额度历史，后台刷新完成后显示。'}</td></tr>`;
  reconcileMarkup(windowBody,windowsMarkup,{enter:false,exit:false});
  for (const row of windowBody.rows) {
    const previous=previousWindows.get(row.dataset.key);
    if (previous && previous !== row.querySelector('.quota-basis')?.textContent && row.querySelector('.quota-basis-full')) highlightChange(row,450);
  }
  let note = '金额含 Codex 会话和订阅桥接 API；独立付费 API 不消耗此额度。用满记录采用首次达到 100% 时的金额；用户确认的历史窗口采用该窗口已记录金额，首次用满时间未知。日均估值排除已知用满后的续跑。';
  note += ' 低于 10% 的外推样本波动较大；有额度但缺少已定价请求的窗口不参与均值。';
  if (day?.usageIsLowerBound) note += ' 跨日窗口缺少午夜前基线，累计额度显示已确认的下限。';
  if (day?.unattributedApiEquivalentUSD > 0.005) note += ` 另有 ${formatUSD(day.unattributedApiEquivalentUSD)} 请求缺少五小时标记，未用于额度均值。`;
  if (history?.latest?.observedAt) note += ` 最近额度记录：${new Date(history.latest.observedAt).toLocaleString('zh-CN', {
    timeZone: timezone,
    hour12: false
  })}。`;
  setText('quota-history-note', note);
  let visible = daily;
  if (state.quotaHistoryRange !== 'all') {
    const cutoff = new Date(`${today}T12:00:00`);
    cutoff.setDate(cutoff.getDate() - Number(state.quotaHistoryRange) + 1);
    visible = daily.filter(row => row.date >= getLocalDateStr(cutoff));
  }
  const dailyMarkup = visible.length ? [...visible].reverse().map(row => `<tr data-key="${esc(row.date)}" class="${row.date === date ? 'quota-selected-day' : ''}">
    <td><button type="button" class="quota-date-button" data-quota-date="${esc(row.date)}" aria-pressed="${row.date === date}">${esc(row.date)}</button></td>
    <td class="font-mono">${percent(row)}</td><td class="font-mono">${units(row)}</td><td class="font-mono">${subtotal(row)}</td>
    <td class="font-mono">${money(row.averagePer100USD)}${row.estimateLowSample ? '<small>样本较小</small>' : ''}</td><td>${row.quotaObserved ? row.completedWindowCount : '--'}</td></tr>`).join('') : '<tr><td colspan="6" class="quota-empty">所选范围暂无日志</td></tr>';
  reconcileMarkup(dailyBody,dailyMarkup,{enter:false,exit:false});
  if (windowBody.dataset.selectedDate !== date) {
    replaceAnimation(windowBody,'date',[{opacity:.3},{opacity:1}],{duration:180});
    windowBody.dataset.selectedDate=date;
  }
  dailyBody.onclick = event => {
    const button = event.target.closest('button[data-quota-date]');
    if (button) selectQuotaDate(button.dataset.quotaDate);
  };
}
function renderTodayDashboard() {
  if (!state.cachedData) return;
  const todayStr = state.cachedData.meta?.today || getLocalDateStr();
  const todaySummary = state.cachedData.todaySummary;
  const todayTimeline = todaySummary || (state.cachedData.timeline || []).find(d => d.date === todayStr);
  const todayImages = todaySummary?.images || (state.cachedData.imageAnalysis?.daily || []).find(d => d.date === todayStr) || {
    count: 0,
    cost: 0,
    tokens: 0
  };

  // Update Today date badge in header
  const elDateBadge = document.getElementById('today-date-badge');
  if (elDateBadge) elDateBadge.innerText = `${todayStr}（今天）`;

  // Calculate Totals
  const mainCost = todayTimeline ? todayTimeline.totalCost : 0;
  const imgCost = todayImages.cost || 0;
  const totalCost = mainCost;
  const mainTokens = todayTimeline ? todayTimeline.totalTokens : 0;
  const imgTokens = todayImages.tokens || 0;
  const totalTokens = mainTokens;
  const cacheTokens = todayTimeline ? todayTimeline.cacheReadTokens : 0;
  const cacheRate = mainTokens > 0 ? +(cacheTokens / mainTokens * 100).toFixed(1) : 0;
  const incompleteCost = Object.values(todayTimeline?.byModel || {}).some(model => model.unpriced || model.costComplete === false);

  // 1. Fill 4 Key Metric Cards
  const elCost = document.getElementById('today-stat-cost');
  const elCostSub = document.getElementById('today-stat-cost-sub');
  animateValue('today-stat-cost', mainCost, incompleteCost && !mainCost && mainTokens ? () => '暂无费率' : formatUSD);
  if (elCost) elCost.title = '按全部来源的请求日志折算；图像工具真实费用未记录，不能据此确定完整总费用';
  if (elCostSub) elCostSub.innerText = (todayImages.count > 0 ? '全部来源请求 · 图像工具费用未记录' : '全部来源请求 · 按日志折算')
    + (incompleteCost ? ' · 仅已定价部分' : '');
  const elTokens = document.getElementById('today-stat-tokens');
  const elTokensSub = document.getElementById('today-stat-tokens-sub');
  animateValue('today-stat-tokens', totalTokens, formatTokens);
  if (elTokensSub) elTokensSub.innerText = `含缓存读取 ${formatTokens(cacheTokens)} · 生图等值另列`;
  const elCache = document.getElementById('today-stat-cache');
  const elCacheSub = document.getElementById('today-stat-cache-sub');
  animateValue('today-stat-cache', cacheTokens, formatTokens);
  if (elCacheSub) elCacheSub.innerText = `缓存读取占比 ${cacheRate}%`;
  const elImages = document.getElementById('today-stat-images');
  const elImagesSub = document.getElementById('today-stat-images-sub');
  animateValue('today-stat-images', todayImages.count, value => `${Math.round(value)} 张`);
  if (elImagesSub) elImagesSub.innerText = `文件参考 ≈${formatUSD(imgCost)} · 不计入合计 · ${formatTokens(imgTokens)} Token 等值`;

  // 1.5 Render Subscription ROI & Quota Utilization (启发一: 订阅制专属回本率与配额监控)
  renderSubscriptionROI();
  renderQuotaHistory();

  // 2. Models Breakdown & Proportional Bar
  const modelsList = [];
  if (todayTimeline && todayTimeline.byModel) {
    for (const [mName, mData] of Object.entries(todayTimeline.byModel)) {
      let color = '#3b82f6';
      if (mData.company === 'Google (Gemini)') color = '#06b6d4';else if (mData.company === '智谱 AI (Z.ai)') color = '#10b981';else if (mData.company === 'DeepSeek') color = '#f43f5e';else if (mData.company === 'Anthropic') color = '#d97706';else if (mData.company === 'xAI') color = '#8b5cf6';else if (mData.company === 'Qwen (通义千问)') color = '#ec4899';else if (mData.company === 'OpenAI') color = '#3b82f6';else {
        const found = (state.cachedData?.companies || []).find(c => c.name === mData.company);
        if (found && found.color) color = found.color;
      }
      modelsList.push({
        name: mName,
        company: mData.company,
        cost: mData.cost,
        tokens: mData.tokens,
        costEstimated: !!mData.costEstimated,
        unpriced: !!mData.unpriced,
        costComplete:mData.costComplete !== false && !mData.unpriced,
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
      isImage: true,
      color: '#ec4899'
    });
  }
  modelsList.sort((a, b) => b.cost - a.cost);

  // Render proportional bar
  const barContainer = document.getElementById('today-proportional-bar');
  if (barContainer) {
    let barHtml = '';
    modelsList.forEach(m => {
      const pct = !m.isImage && totalCost > 0 ? +(m.cost / totalCost * 100).toFixed(1) : 0;
      if (pct > 0) {
        barHtml += `<div data-key="${esc(m.name)}" class="today-bar-seg" style="width: ${pct}%; background: ${m.color};" title="${esc(m.name)}: ${pct}% (${formatUSD(m.cost)})"></div>`;
      }
    });
    reconcileMarkup(barContainer,barHtml,{enter:false,exit:false});
  }

  // Render models list
  const listContainer = document.getElementById('today-models-list');
  if (listContainer) {
    const wasExpanded = listContainer.querySelector('.today-more-models')?.open || false;
    const rows = [];
    modelsList.forEach(m => {
      const pct = !m.isImage && totalCost > 0 ? +(m.cost / totalCost * 100).toFixed(1) : 0;
      rows.push(`
        <div class="today-model-item" data-key="${esc(m.name)}" tabindex="0">
          <div class="today-model-left">
            <span class="today-model-dot" style="background: ${m.color};"></span>
            <div>
              <div class="today-model-name">${esc(m.name)}</div>
              <div class="today-model-company">${esc(m.company)} · ${m.isImage ? '文件数参考，不计入合计与占比' : m.name === 'codex-auto-review' ? `审批路由 · 费用依据见价格说明 · 占比 ${pct}%` : `占比 ${pct}%`}</div>
            </div>
          </div>
          <div class="today-model-stats">
            <span class="today-model-cost font-mono">${m.isImage ? '文件参考 ≈' + formatUSD(m.cost)
              : m.costComplete === false && !m.cost ? '暂无费率'
                : (m.costEstimated ? '≈' : '') + formatUSD(m.cost) + (m.costComplete === false ? '（已定价部分）' : '')}</span>
            <span class="today-model-tokens font-mono">${formatTokens(m.tokens)} ${m.isImage ? 'Token 等值' : 'Token'}</span>
          </div>
        </div>
      `);
    });
    const listHtml = rows.slice(0, 6).join('') + (rows.length > 6 ? `<details class="today-more-models" ${wasExpanded ? 'open' : ''}><summary>其余 ${rows.length - 6} 个模型</summary>${rows.slice(6).join('')}</details>` : '');
    reconcileMarkup(listContainer,listHtml || '<div class="empty-state">今日暂无模型消耗记录</div>');
    const focus = key => {
      if (key) barContainer.dataset.modelFocus=key; else delete barContainer.dataset.modelFocus;
      for (const segment of barContainer.children) segment.dataset.focused=String(segment.dataset.key===key);
    };
    listContainer.querySelectorAll('.today-model-item').forEach(row=>{
      row.onpointerenter=row.onfocus=()=>focus(row.dataset.key);
      row.onpointerleave=row.onblur=()=>focus(null);
    });
  }

  // 3. Render Active Workspaces
  const activeProjects = (state.cachedData.projects || []).filter(p => p.lastActive === todayStr).sort((a, b) => b.totalCost - a.totalCost);
  document.getElementById('today-active-badge').textContent = `${activeProjects.length} 个今日活跃工程`;
  const wsContainer = document.getElementById('today-workspaces-section');
  if (wsContainer) {
    if (activeProjects.length === 0) {
      reconcileMarkup(wsContainer, `<div style="color:var(--text-dim);font-size:12px;padding:12px;text-align:center;">今日暂无可归因的活跃工程</div>`);
    } else {
      let wsHtml = '';
      activeProjects.slice(0, 5).forEach(p => {
        wsHtml += `
          <div class="today-workspace-card" data-key="${esc(p.id)}" role="button" tabindex="0" aria-label="${esc('查看今日工程 '+p.name)}">
            <div class="today-ws-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3V7Z"/></svg></div>
            <div class="today-ws-info">
              <div class="today-ws-name">${esc(p.name)}</div>
              <div class="today-ws-meta"><span class="path" title="${esc(p.primaryPath)}">${esc(compactDisplayPath(p.primaryPath))}</span><span class="today-ws-total">累计 API 等值 ${formatUSD(p.totalCost)}</span></div>
            </div>
          </div>
        `;
      });
      reconcileMarkup(wsContainer,wsHtml);
      wsContainer.querySelectorAll('.today-workspace-card').forEach(card=>{
        card.onclick=()=>showTodayProjects(card.dataset.key);
        card.onkeydown=event=>{ if (event.key==='Enter'||event.key===' ') { event.preventDefault(); card.click(); } };
      });
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn-secondary btn-sm today-workspaces-more';
      more.textContent = `查看今日 ${activeProjects.length} 个工程 →`;
      more.dataset.key='more';
      more.onclick = () => showTodayProjects();
      wsContainer.appendChild(more);
    }
  }

  // 4. Render Today Image Strip (Latest 8 images)
  const stripContainer = document.getElementById('today-image-strip');
  if (stripContainer && state.cachedData.imageAnalysis?.recentImages) {
    const todayImgs = state.cachedData.imageAnalysis.recentImages.filter(img => img.date === todayStr).slice(0, 8);
    let stripHtml = '';
    todayImgs.forEach((img, index) => {
      const imgSrc = `/api/codex-image?path=${encodeURIComponent(img.filePath)}`;
      const isNew = imageStripInitialized && !knownTodayImages.has(img.filePath);
      knownTodayImages.add(img.filePath);
      stripHtml += `
        <div data-key="${esc(img.filePath)}" ${isNew ? 'data-new="新图"' : ''} class="today-strip-thumb is-image-loading" role="button" tabindex="0" data-image-index="${index}" aria-label="${esc('预览 ' + (img.prompt || '生成图像'))}" title="${esc(img.prompt || 'Codex 生图')} (${esc(img.fileSize)})">
          <img src="${imgSrc}" loading="lazy" alt="${esc(img.prompt || '生成图像')}" onload="handleThumbnailLoad(this)" onerror="handleThumbnailError(this)">
        </div>
      `;
    });
    imageStripInitialized = true;
    reconcileMarkup(stripContainer,stripHtml || '<div style="grid-column:1/-1;color:var(--text-dim);font-size:11px;">今日无新生成图像</div>');
    stripContainer.querySelectorAll('[data-image-index]').forEach(card => {
      card.onclick = () => {
        card.focus({
          preventScroll: true
        });
        openLightbox(todayImgs, Number(card.dataset.imageIndex));
      };
      card.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          card.onclick();
        }
      };
    });
  }
}

// ── Model Pricing Matrix Modal Logic ───────────
export { selectQuotaDate, setQuotaHistoryRange, renderQuotaHistory, renderTodayDashboard };
