import { feedbackButton, getMotionPolicy, highlightChange, setText } from './motion.js';
import { openProjectUsage } from './insights.js';
import { state } from './state.js';
import { animateDisclosure, compactDisplayPath, emptyState, esc, formatTokens, formatUSD, getLocalDateStr, reconcileCards, renderPagination } from './utils.js';
import { animateValue } from './experience.js';
import { refreshData, switchViewMode } from './app.js';
// 6. Render Projects Attribution View
function renderProjects() {
  if (!state.cachedData || !state.cachedData.projects) return;
  const rawProjects = state.cachedData.projects;
  const kw = (state.projectSearchTerm || '').toLowerCase().trim();

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
    if (state.projectTodayOnly && p.lastActive !== (state.cachedData.meta?.today || getLocalDateStr())) return false;
    // Agent filter
    if (state.projectAgentFilter !== 'all') {
      if (!p.agents.includes(state.projectAgentFilter)) return false;
    }
    return true;
  });

  // 2. Sort
  filtered.sort((a, b) => {
    if (state.projectSortBy === 'cost') return b.totalCost - a.totalCost;
    if (state.projectSortBy === 'tokens') return b.totalTokens - a.totalTokens;
    if (state.projectSortBy === 'active') return (b.lastActive || '').localeCompare(a.lastActive || '');
    return 0;
  });

  // 3. Update Summary Bar
  const totalCost = filtered.reduce((s, p) => s + p.totalCost, 0);
  const totalTokens = filtered.reduce((s, p) => s + p.totalTokens, 0);
  const elCount = document.getElementById('proj-stat-count');
  const elCost = document.getElementById('proj-stat-cost');
  const elTokens = document.getElementById('proj-stat-tokens');
  animateValue('proj-stat-count', filtered.length, value => `${Math.round(value)} 个工程`);
  animateValue('proj-stat-cost', totalCost, formatUSD);
  animateValue('proj-stat-tokens', totalTokens, formatTokens);
  const focus = [...filtered].sort((a, b) => b.totalCost - a.totalCost)[0];
  const focusValue = document.getElementById('proj-stat-focus');
  setText(focusValue,focus?.name || '暂无工程');
  focusValue.dataset.projectId = focus?.id || '';
  focusValue.setAttribute('role','button');
  focusValue.tabIndex = focus ? 0 : -1;
  focusValue.setAttribute('aria-disabled',String(!focus));
  focusValue.setAttribute('aria-label',focus ? `定位主要消耗工程 ${focus.name}` : '暂无主要消耗工程');
  focusValue.onclick = () => {
    const index=filtered.findIndex(project=>project.id===focus?.id);
    if (index<0) return;
    const page=Math.floor(index/state.pagination.projects.size)+1;
    if (state.pagination.projects.page!==page) { state.pagination.projects.page=page; renderProjects(); }
    const card = [...document.querySelectorAll('#projects-grid .project-card')].find(card=>card.dataset.key===focusValue.dataset.projectId);
    if (card) {
      card.scrollIntoView({block:'nearest',behavior:getMotionPolicy().enabled ? 'smooth' : 'auto'});
      card.focus({preventScroll:true}); highlightChange(card,500);
    }
  };
  focusValue.onkeydown = event => { if (event.key==='Enter'||event.key===' ') { event.preventDefault(); focusValue.click(); } };
  focusValue.title = focus ? `${focus.name} · ${focus.primaryPath}` : '';
  document.getElementById('proj-focus-hint').textContent = focus ? `${formatUSD(focus.totalCost)} · 占当前筛选 ${totalCost ? (focus.totalCost / totalCost * 100).toFixed(1) : '0.0'}%` : '清除筛选可查看其他工程';
  const todayButton = document.getElementById('project-today-only');
  todayButton.classList.toggle('active', state.projectTodayOnly);
  todayButton.setAttribute('aria-pressed', String(state.projectTodayOnly));
  document.getElementById('projects-results-summary').textContent = `${filtered.length} / ${rawProjects.length} 个工程 · ${state.projectTodayOnly ? '今日活跃 · ' : ''}${state.projectSortBy === 'cost' ? '按累计金额' : state.projectSortBy === 'tokens' ? '按 Token' : '按最近活动'}`;

  // 4. Render Grid
  const grid = document.getElementById('projects-grid');
  if (!grid) return;
  renderPagination('projects', filtered.length, renderProjects);
  const nextCards = [];
  if (filtered.length === 0) {
    grid.replaceChildren(emptyState(kw || state.projectAgentFilter !== 'all' || state.projectTodayOnly ? '没有匹配的工程' : '暂无本地工程记录', kw || state.projectAgentFilter !== 'all' || state.projectTodayOnly ? '清除筛选' : '重新读取日志', () => {
      state.projectTodayOnly = false;
      state.projectSearchTerm = '';
      document.getElementById('project-search-input').value = '';
      state.pagination.projects.page = 1;
      setProjectAgentFilter('all');
      if (!rawProjects.length) refreshData();
    }));
    return;
  }
  const offset = (state.pagination.projects.page - 1) * state.pagination.projects.size;
  filtered.slice(offset, offset + state.pagination.projects.size).forEach((p, index) => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.dataset.key = p.id;
    card.tabIndex = -1;
    card.setAttribute('role','group');
    card.setAttribute('aria-label',`工程 ${p.name}`);
    const isExpanded = state.expandedProjectDrawers.has(p.id);

    // Agent Badges
    const agents = {
      codex: ['Codex', 'badge-codex'],
      claude: ['Claude', 'badge-anthropic'],
      grok: ['Grok', 'badge-xai'],
      zcode: ['ZCode', 'badge-zcode'],
      antigravity: ['Antigravity', 'badge-agy'],
      openclaw: ['OpenClaw', 'badge-other'],
      reasonix: ['Reasonix', 'badge-other'],
      api: ['业务 API', 'badge-other'],
      qwen: ['Qwen', 'badge-qwen'],
      qoderwork: ['QoderWork · 估算', 'badge-qoderwork']
    };
    const agentBadgesHtml = p.agents.map(agent => {
      const [label, cls] = agents[agent] || [agent, 'badge-other'];
      return `<span class="badge-pill-agent ${cls}">${esc(label)}</span>`;
    }).join('');
    const description = p.desc && p.desc !== p.primaryPath && !/^(?:[a-z]:[\/]|\\|\/)/i.test(p.desc) ? p.desc : '';
    const share = totalCost > 0 ? p.totalCost / totalCost * 100 : 0;

    // Company segments
    const compSegsHtml = `
      <div class="project-company-seg" style="width: ${p.companies.openai.percent}%; background: #3b82f6;" title="OpenAI: ${p.companies.openai.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.anthropic?.percent || 0}%; background: #d97706;" title="Anthropic: ${p.companies.anthropic?.percent || 0}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.xai?.percent || 0}%; background: #8b5cf6;" title="xAI: ${p.companies.xai?.percent || 0}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.zcode.percent}%; background: #10b981;" title="智谱: ${p.companies.zcode.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.deepseek.percent}%; background: #f43f5e;" title="DeepSeek: ${p.companies.deepseek.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.gemini.percent}%; background: #06b6d4;" title="Gemini: ${p.companies.gemini.percent}%"></div>
      <div class="project-company-seg" style="width: ${p.companies.qwen?.percent || 0}%; background: #ec4899;" title="Qwen: ${p.companies.qwen?.percent || 0}%"></div>
    `;

    // Sub paths html
    const pathsHtml = (p.paths || []).map(pth => `<div class="drawer-path-item">• ${esc(pth)}</div>`).join('');

    // Top models html
    const modelsHtml = (p.topModels || []).map(m => `
      <div class="drawer-model-row">
        <span class="drawer-model-name">${esc(m.model)}</span>
        <span class="drawer-model-tokens font-mono">${formatTokens(m.tokens)} Tokens</span>
      </div>
    `).join('');
    card.innerHTML = `
      <div class="project-card-header">
        <div class="project-card-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3V7Z"/></svg></div>
        <div class="project-card-title-group">
          <div class="project-card-name" title="${esc(p.name)}">${esc(p.name)}</div>
          ${description ? `<div class="project-card-desc" title="${esc(description)}">${esc(description)}</div>` : ''}
        </div>
        <span class="project-rank font-mono" title="当前排序中的位置">${String(offset + index + 1).padStart(2, '0')}</span>
      </div>
      <div class="project-metrics-box">
        <div class="project-metrics-cost">
          <span class="cost-label">${p.costComplete === false ? '已定价部分' : 'API 等值估算'}${p.estimated ? ' · 含正文估算' : ''}</span>
          <span class="cost-val font-mono">${p.costComplete === false && !p.totalCost && p.totalTokens ? '暂无费率' : formatUSD(p.totalCost)}</span>
        </div>
        <div class="project-metrics-tokens font-mono">
          <div class="tok-val">${formatTokens(p.totalTokens)} Token</div>
          <div class="tok-sub">最近活动 ${esc(p.lastActive || "—")}</div>
        </div>
      </div>

      <div class="project-path-pill" title="${esc(p.primaryPath)}">
        <span>${esc(compactDisplayPath(p.primaryPath))}</span>
        ${p.pathCount > 1 ? `<span class="path-count-badge">+${p.pathCount - 1} 子目录</span>` : ''}
      </div>

      <div class="project-share-row"><span>占当前筛选金额</span><strong class="font-mono">${share.toFixed(1)}%</strong><div class="project-share-meter" aria-hidden="true"><span style="width:${Math.min(100, share).toFixed(2)}%"></span></div></div>
      ${Object.values(p.companies).filter(company => company.percent > 0).length > 1 ? `<div class="project-company-bar" title="工程内各厂商消耗占比">${compSegsHtml}</div>` : ''}

      <div class="project-card-footer">
        <div class="project-agent-badges">
          ${agentBadgesHtml}
        </div>
        <div class="project-footer-actions"><button type="button" class="btn-secondary btn-sm" data-project-usage="${esc(p.id)}">按日与请求</button><button class="copy-path-btn" data-copy-project="${esc(p.id)}" ${p.primaryPath ? '' : 'disabled'} aria-label="复制 ${esc(p.name)} 的完整路径" title="复制完整工程路径">复制路径</button><button class="project-expand-btn" id="btn-expand-${p.id}" data-project-id="${esc(p.id)}" aria-expanded="${isExpanded}" aria-controls="drawer-${esc(p.id)}">
          <span class="disclosure-label">${isExpanded ? '收起明细' : '展开明细'}</span><svg class="disclosure-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button></div>
      </div>

      <div class="project-details-drawer ${isExpanded ? 'expanded' : ''}" id="drawer-${esc(p.id)}" aria-hidden="${!isExpanded}" ${isExpanded ? '' : 'inert'}>
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
    nextCards.push(card);
  });
  reconcileCards(grid, nextCards);
  grid.querySelectorAll('[data-project-usage]').forEach(button => button.onclick = () => openProjectUsage(button.dataset.projectUsage));
  grid.querySelectorAll('[data-copy-project]').forEach(button => button.onclick = () => copyProjectPath(button.dataset.copyProject, button));
  grid.querySelectorAll('.project-expand-btn').forEach(button => button.onclick = event => toggleProjectDrawer(button.dataset.projectId, event));
}
function filterProjects() {
  state.pagination.projects.page = 1;
  state.projectSearchTerm = document.getElementById('project-search-input').value;
  renderProjects();
}
function toggleProjectTodayOnly() {
  state.projectTodayOnly = !state.projectTodayOnly;
  state.pagination.projects.page = 1;
  renderProjects();
}
function showTodayProjects(projectId) {
  state.projectTodayOnly = true;
  state.projectSearchTerm = '';
  state.projectAgentFilter = 'all';
  state.projectSortBy = 'active';
  document.getElementById('project-search-input').value = '';
  state.pagination.projects.page = 1;
  document.querySelectorAll('.projects-toolbar button[id^="proj-agent-"]').forEach(button => button.classList.toggle('active', button.id === 'proj-agent-all'));
  document.querySelectorAll('.projects-toolbar button[id^="proj-sort-"]').forEach(button => button.classList.toggle('active', button.id === 'proj-sort-active'));
  switchViewMode('projects');
  const card = [...document.querySelectorAll('#projects-grid .project-card')].find(card=>card.dataset.key===projectId);
  if (card) highlightChange(card,500);
}
async function copyProjectPath(id, button) {
  const project = state.cachedData?.projects?.find(project => project.id === id);
  if (!project?.primaryPath) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(project.primaryPath);else {
      const input = document.createElement('textarea');
      input.value = project.primaryPath;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      button.focus();
      if (!copied) throw new Error('Clipboard unavailable');
    }
    button.textContent = '已复制';
    feedbackButton(button);
  } catch (error) {
    button.textContent = '复制失败';
    feedbackButton(button,{success:false});
    button.title = '可在展开明细中选择完整路径进行复制';
  }
  button.setAttribute('aria-live', 'polite');
  setTimeout(() => {
    if (button.isConnected) button.textContent = '复制路径';
  }, 1800);
}
function setProjectAgentFilter(agent) {
  state.pagination.projects.page = 1;
  state.projectAgentFilter = agent;
  document.querySelectorAll('.projects-toolbar .chip-group button[id^="proj-agent-"]').forEach(btn => {
    btn.classList.toggle('active', btn.id === `proj-agent-${agent}`);
  });
  renderProjects();
}
function setProjectSort(sort) {
  state.pagination.projects.page = 1;
  state.projectSortBy = sort;
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
  const fromHeight = drawer.getBoundingClientRect().height;
  const isExpanded = drawer.classList.toggle('expanded');
  drawer.setAttribute('aria-hidden', String(!isExpanded));
  drawer.inert = !isExpanded;
  btn?.setAttribute('aria-expanded', String(isExpanded));
  animateDisclosure(drawer, isExpanded, { fromHeight });
  if (isExpanded) {
    state.expandedProjectDrawers.add(id);
    if (btn) btn.querySelector('.disclosure-label').textContent = '收起明细';
  } else {
    state.expandedProjectDrawers.delete(id);
    if (btn) btn.querySelector('.disclosure-label').textContent = '展开明细';
  }
}
export { renderProjects, filterProjects, toggleProjectTodayOnly, showTodayProjects, copyProjectPath, setProjectAgentFilter, setProjectSort, toggleProjectDrawer };
