import { feedbackButton, highlightChange, replaceAnimation, setBusy, setText } from './motion.js';
import { state } from './state.js';
import { requestJSON, queryString, downloadExport } from './api.js';
import { reconcileMarkup, esc, formatTokens, formatUSD } from './utils.js';
import { showOverlay, hideOverlay } from './experience.js';
import { loadDashboard, getFilteredTimeline } from './app.js';

let requestEpoch = 0, detailController = null, selectedProject = null, offset = 0, sourcesController = null;
const pageSize = 50;
const byId = id => document.getElementById(id);
function addDialog(id, title, content) {
  const overlay = document.createElement('div');
  overlay.id = id; overlay.className = 'modal-backdrop insights-overlay'; overlay.style.display = 'none';
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', `${id}-title`); overlay.tabIndex = -1;
  overlay.innerHTML = `<div class="modal-content insights-dialog"><header class="insights-dialog-heading"><h2 id="${id}-title">${title}</h2><button type="button" class="btn-secondary insights-close" aria-label="关闭${title}">关闭</button></header>${content}</div>`;
  overlay.querySelector('.insights-close').addEventListener('click', () => hideOverlay(id));
  overlay.addEventListener('click', event => { if (event.target === overlay) hideOverlay(id); });
  document.body.appendChild(overlay);
}

function sourceRows(sources) {
  const labels = { ccusage: 'Codex / ccusage', claude: 'Claude Code', qwen: 'Qwen', qoderwork: 'QoderWork',
    zcode: 'ZCode', antigravity: 'Antigravity', openclaw: 'OpenClaw', reasonix: 'Reasonix', api: '业务 API', images: '图像资产', codexAccount: 'Codex 账号额度' };
  const statuses = { ready: '有用量记录', empty: '已读取，暂无用量', unavailable: '未找到日志', partial: '部分读取失败', disabled: '未启用' };
  return Object.entries(sources || {}).map(([key, source]) => {
    const status = source.status || (source.error ? 'partial' : source.available ? 'ready' : 'unavailable');
    return `<tr data-key="${esc(key)}"><th scope="row">${esc(labels[key] || key)}${source.stale ? '<span class="insights-badge">旧数据</span>' : ''}</th>
      <td>${esc(statuses[status] || status)}${source.refreshing ? ' · 更新中' : ''}${source.error ? `<p class="insights-error">${esc(source.error)}</p>` : ''}</td>
      <td>${esc(source.lastSuccessfulAt ? new Date(source.lastSuccessfulAt).toLocaleString('zh-CN') : '尚未成功读取')}</td>
      <td>${Number(source.parseErrors || 0)} / ${Number(source.readErrors || 0)}${source.pendingLines ? `<br>等待补全 ${Number(source.pendingLines)} 行` : ''}${source.undatedRecords ? `<br>${Number(source.undatedRecords)} 条缺少日期` : ''}</td>
      <td>${esc(source.coverage?.from || '—')}<br>${esc(source.coverage?.to || '—')}</td>
      <td class="insights-path">${(source.paths || []).map(path => `<div>${esc(path)}</div>`).join('') || '来源未提供原始路径'}${source.pathNotice ? `<p>${esc(source.pathNotice)}</p>` : ''}</td></tr>`;
  }).join('');
}

export async function openSources() {
  showOverlay('sources-modal');
  sourcesController?.abort(); sourcesController = new AbortController();
  setBusy('sources-modal',true);
  byId('sources-message').textContent = '正在读取来源状态…';
  if (state.cachedData?.meta?.sources) reconcileMarkup('sources-rows',sourceRows(state.cachedData.meta.sources),{enter:false,exit:false});
  try {
    const data = await requestJSON('/api/sources', { signal: sourcesController.signal });
    const before = new Map([...byId('sources-rows').rows].map(row=>[row.dataset.key,row.cells[1]?.textContent]));
    reconcileMarkup('sources-rows',sourceRows(data.sources),{enter:false,exit:false});
    for (const row of byId('sources-rows').rows) if (before.has(row.dataset.key) && before.get(row.dataset.key)!==row.cells[1]?.textContent) highlightChange(row,350);
    byId('sources-message').textContent = data.meta?.stale ? '部分来源正在显示上次成功数据。' : '以下为最近一次索引的来源状态。';
    const capabilities = data.capabilities || {};
    byId('sources-capabilities').textContent = `Node ${capabilities.node || '—'} · SQLite ${capabilities.sqlite ? '可用' : '不可用'} · 压缩归档 ${capabilities.zstandard ? '可用' : '不可用'}${capabilities.limitations?.length ? ' · ' + capabilities.limitations.join(' ') : ''}`;
  } catch (error) {
    if (error.name !== 'AbortError') byId('sources-message').textContent = `状态读取失败（${error.message}），保留已显示的来源信息。可点击重试。`;
  } finally { setBusy('sources-modal',false); }
}

export function renderInsights() {
  if (!byId('actual-only')) return;
  byId('actual-only').checked = state.actualOnly;
  const days = getFilteredTimeline(), total = days.reduce((sum, day) => sum + day.totalTokens, 0);
  const estimated = days.reduce((sum, day) => sum + (day.estimatedTokens || 0), 0);
  const text = state.actualOnly ? '已隐藏估算 Token' : `所选区间估算 Token 占比 ${total ? (estimated / total * 100).toFixed(1) : '0.0'}%`;
  setText('estimate-summary',text + ' · 金额仍为 API 等值参考');
  const pricing = state.cachedData?.meta?.pricing;
  const select = byId('pricing-mode');
  const versions = pricing?.versions || [];
  const signature = versions.map(version => version.id).join(',');
  if (select.dataset.versions !== signature) {
    select.querySelectorAll('[data-history-version]').forEach(option => option.remove());
    for (const version of versions) {
      if (version.id === pricing.currentVersion) continue;
      const option = document.createElement('option'); option.value = version.id; option.dataset.historyVersion = 'true';
      option.textContent = `${new Date(version.capturedAt).toLocaleDateString('zh-CN')} 捕获费率 · ${version.id.slice(-6)}`;
      select.appendChild(option);
    }
    select.dataset.versions = signature;
  }
  select.value = state.pricingVersion || state.pricingMode;
  setText('pricing-basis',pricing?.error || (state.pricingMode === 'recorded'
    ? '日志金额 / 首次索引费率，不推测发生时官方历史价' : `按${state.pricingVersion ? '已保存历史' : '当前'}费率重算，非实际账单`));
  byId('export-json').disabled = !state.cachedData; byId('export-csv').disabled = !state.cachedData;
}

async function exportSelection(format, project = false) {
  const filters = { tier: state.currentPricingTier, actualOnly: state.actualOnly,
    pricingMode: state.pricingMode, pricingVersion: state.pricingVersion };
  if (project) {
    filters.projectId = selectedProject.id; filters.agent = state.projectAgentFilter;
    filters.startDate = byId('project-usage-date').value; filters.endDate = filters.startDate;
  } else {
    filters.agent = state.currentAgentFilter; filters.startDate = state.startDate; filters.endDate = state.endDate;
  }
  const message = byId(project ? 'project-export-status' : 'export-status');
  const buttons = project ? byId('project-usage-modal').querySelectorAll('[data-export-format]') : [byId(`export-${format}`)];
  buttons.forEach(button=>{setBusy(button,true);button.disabled=true;});
  message.textContent = '正在生成导出…';
  try { await downloadExport(format, filters); message.textContent = '已生成导出，包含筛选条件、时区、价格版本与估算依据。'; buttons.forEach(button=>feedbackButton(button)); }
  catch (error) { message.textContent = `导出失败（${error.message}），可重试。`; buttons.forEach(button=>feedbackButton(button,{success:false})); }
  finally { buttons.forEach(button=>{setBusy(button,false);button.disabled=false;}); }
}

export function openProjectUsage(projectId) {
  selectedProject = state.cachedData?.projects?.find(project => project.id === projectId);
  if (!selectedProject) return;
  offset = 0; byId('project-usage-date').value = '';
  byId('project-usage-modal-title').textContent = `${selectedProject.name} · 按日与请求明细`;
  byId('project-usage-path').textContent = selectedProject.primaryPath || '未记录工作目录，保留为未归因用量。';
  const dayMarkup = (selectedProject.daily || []).slice().reverse().map(day =>
    `<tr data-key="${esc(day.date)}"><td>${esc(day.date)}</td><td>${formatTokens(day.totalTokens)}</td><td>${formatUSD(day.totalCost)}</td></tr>`).join('')
    || '<tr><td colspan="3">暂无按日明细</td></tr>';
  reconcileMarkup('project-usage-days',dayMarkup,{enter:false,exit:false});
  showOverlay('project-usage-modal');
  loadProjectUsage();
}

export async function loadProjectUsage() {
  if (!selectedProject) return;
  const epoch = ++requestEpoch;
  detailController?.abort(); detailController = new AbortController();
  setBusy('project-usage-rows',true);
  byId('project-usage-message').textContent = '正在读取明细…';
  const date = byId('project-usage-date').value;
  const filters = { projectId: selectedProject.id, agent: state.projectAgentFilter, tier: state.currentPricingTier,
    actualOnly: state.actualOnly, pricingMode: state.pricingMode, pricingVersion: state.pricingVersion,
    offset, limit: pageSize, startDate: date || null, endDate: date || null };
  try {
    const data = await requestJSON(`/api/usage-records?${queryString(filters)}`, { signal: detailController.signal });
    if (epoch !== requestEpoch) return;
    byId('project-usage-message').textContent = `${date || '全部日期'} · ${data.totalCount} 条记录 · ${formatTokens(data.totals.totalTokens)} Token · ${formatUSD(data.totals.totalCostUSD)}${data.totals.costComplete === false ? '（仅已定价部分）' : ''}`;
    const rowsMarkup = data.records.map(row => `<tr data-key="${esc(row.id)}">
      <td>${esc(row.timestamp ? new Date(row.timestamp).toLocaleString('zh-CN') : row.date + ' · 仅日汇总')}</td>
      <td>${esc(row.source)}</td><td>${esc(row.model)}</td><td class="insights-path">${esc(row.sessionId || '未提供')}</td>
      <td>${formatTokens(row.totalTokens)}${row.estimated ? ' · 估算' : ''}</td>
      <td>${row.costUSD == null ? '暂无费率' : formatUSD(row.costUSD)}${row.costComplete === false ? ' · 不完整' : ''}</td></tr>`).join('')
      || '<tr><td colspan="6">该日期暂无记录</td></tr>';
    reconcileMarkup('project-usage-rows',rowsMarkup,{enter:false,exit:false});
    replaceAnimation(byId('project-usage-rows'),'records',[{opacity:.15},{opacity:1}],{duration:280});
    byId('project-usage-prev').disabled = offset === 0;
    byId('project-usage-next').disabled = offset + pageSize >= data.totalCount;
  } catch (error) {
    if (error.name !== 'AbortError' && epoch === requestEpoch) byId('project-usage-message').textContent = `明细读取失败（${error.message}），可点击重试。`;
  } finally { if (epoch === requestEpoch) setBusy('project-usage-rows',false); }
}

export function initInsights() {
  addDialog('sources-modal', '来源状态', `<p id="sources-message" role="status"></p><p id="sources-capabilities"></p><button type="button" class="btn-secondary btn-sm" id="sources-retry">重试读取</button><div class="insights-table-wrap"><table><thead><tr><th>来源</th><th>状态</th><th>最后成功读取</th><th>解析 / 读取失败</th><th>覆盖日期</th><th>日志路径</th></tr></thead><tbody id="sources-rows"></tbody></table></div>`);
  addDialog('project-usage-modal', '工程用量明细', `<p id="project-usage-path" class="insights-path"></p><div class="insights-detail-controls"><label>查看日期 <input type="date" id="project-usage-date"></label><button type="button" class="btn-secondary btn-sm" id="project-usage-today">今天</button><button type="button" class="btn-secondary btn-sm" id="project-usage-all">全部日期</button><button type="button" class="btn-secondary btn-sm" id="project-usage-retry">重试读取</button></div><p id="project-usage-message" role="status"></p><details><summary>工程按日汇总</summary><div class="insights-table-wrap"><table><thead><tr><th>日期</th><th>Token</th><th>API 等值</th></tr></thead><tbody id="project-usage-days"></tbody></table></div></details><div class="insights-table-wrap"><table><thead><tr><th>用量时间</th><th>来源</th><th>模型</th><th>会话</th><th>Token</th><th>API 等值</th></tr></thead><tbody id="project-usage-rows"></tbody></table></div><div class="insights-detail-controls"><button type="button" id="project-usage-prev" class="btn-secondary btn-sm">上一页</button><button type="button" id="project-usage-next" class="btn-secondary btn-sm">下一页</button></div><p>新输入、缓存读取和输出分别计数；仅有日汇总的来源保留为未归因用量，不推测具体请求。</p>`);
  byId('btn-sources').addEventListener('click', openSources);
  byId('sources-retry').addEventListener('click', openSources);
  byId('pricing-mode').addEventListener('change', async event => {
    const value = event.target.value;
    state.pricingMode = value === 'recorded' ? 'recorded' : 'current';
    state.pricingVersion = value.startsWith('catalog-') ? value : null;
    await loadDashboard();
  });
  byId('export-json').addEventListener('click', () => exportSelection('json'));
  byId('export-csv').addEventListener('click', () => exportSelection('csv'));
  const projectExports = document.createElement('div'); projectExports.className = 'insights-detail-controls';
  for (const format of ['json', 'csv']) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-secondary btn-sm';
    button.dataset.exportFormat=format;
    button.textContent = `导出本工程 ${format.toUpperCase()}`; button.addEventListener('click', () => exportSelection(format, true));
    projectExports.appendChild(button);
  }
  const projectExportStatus = document.createElement('span'); projectExportStatus.id = 'project-export-status'; projectExportStatus.setAttribute('role', 'status');
  projectExports.appendChild(projectExportStatus);
  byId('project-usage-modal').querySelector('.insights-dialog').appendChild(projectExports);
  byId('actual-only').addEventListener('change', async event => { state.actualOnly = event.target.checked; await loadDashboard(); });
  byId('project-usage-date').addEventListener('change', () => { offset = 0; loadProjectUsage(); });
  byId('project-usage-today').addEventListener('click', () => { byId('project-usage-date').value = state.cachedData.meta.today; offset = 0; loadProjectUsage(); });
  byId('project-usage-all').addEventListener('click', () => { byId('project-usage-date').value = ''; offset = 0; loadProjectUsage(); });
  byId('project-usage-retry').addEventListener('click', loadProjectUsage);
  byId('project-usage-prev').addEventListener('click', () => { offset = Math.max(0, offset - pageSize); loadProjectUsage(); });
  byId('project-usage-next').addEventListener('click', () => { offset += pageSize; loadProjectUsage(); });
}
