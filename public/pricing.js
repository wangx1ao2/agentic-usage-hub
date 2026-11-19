import { replaceAnimation, setBusy } from './motion.js';
import { requestJSON } from './api.js';
import { hideOverlay, showOverlay } from './experience.js';
import { state } from './state.js';
import { reconcileMarkup, emptyState, esc } from './utils.js';
async function togglePricingModal() {
  const modal = document.getElementById('pricing-modal');
  if (!modal) return;
  const isHidden = modal.style.display === 'none' || !modal.style.display;
  if (isHidden) {
    showOverlay('pricing-modal');
    if (!state.cachedPricingMatrix) {
      await loadPricingMatrix();
    }
  } else {
    hideOverlay('pricing-modal');
  }
}
async function loadPricingMatrix() {
  const tbody = document.getElementById('pricing-table-body');
  if (!tbody) return;
  setBusy('pricing-modal',true);
  tbody.innerHTML = '<tr class="motion-table-skeleton"><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">正在加载参考费率...</td></tr>';
  try {
    const data = await requestJSON('/api/models-pricing');
    state.cachedPricingMatrix = data;
    renderPricingTable(data.models, data.companies);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:#f43f5e">获取价目表失败: ${esc(err.message)} <button class="btn-secondary" onclick="loadPricingMatrix()">重试</button></td></tr>`;
  } finally { setBusy('pricing-modal',false); }
}
function renderPricingTable(models, companies) {
  const tbody = document.getElementById('pricing-table-body');
  if (!tbody) return;
  const entries = Object.entries(models || {});
  let html = '';
  for (const [mKey, mVal] of entries) {
    const compConf = companies && companies[mVal.company] || {
      color: '#94a3b8',
      badgeClass: 'badge-other'
    };
    const std = mVal.standard || {};
    html += `
      <tr data-key="${esc(mKey)}" class="pricing-row" data-search="${esc(mKey)} ${esc(mVal.label || '')} ${esc(mVal.company || '')}">
        <td>
          <span class="pricing-provider-tag ${compConf.badgeClass || ''}">${esc(mVal.company)}</span>
        </td>
        <td>
          <strong style="color:var(--text-main)">${esc(mVal.label || mKey)}</strong>
          <div style="font-size:11px;color:var(--text-dim);font-family:monospace">${esc(mKey)}</div>
        </td>
        <td class="font-mono text-emerald">${mVal.unpriced ? '暂无费率' : '$' + Number(std.in || 0).toFixed(2)}</td>
        <td class="font-mono text-blue">${mVal.unpriced ? '暂无费率' : '$' + Number(std.out || 0).toFixed(2)}</td>
        <td class="font-mono text-purple">${mVal.unpriced ? '暂无费率' : '$' + Number(std.cache || 0).toFixed(3)}</td>
        <td>
          <span style="font-size:12px;color:var(--text-muted)">${esc(mVal.agent || 'cli')}</span>
        </td>
      </tr>
    `;
  }
  reconcileMarkup(tbody,html || '<tr><td colspan="6"><div class="empty-state">暂无模型参考费率</div></td></tr>',{enter:false,exit:false});
  replaceAnimation(tbody,'pricing',[{opacity:.3},{opacity:1}],{duration:180});
  if (document.getElementById('pricing-search-input')?.value) filterPricingTable();
}
function filterPricingTable() {
  replaceAnimation(document.getElementById('pricing-table-body'),'search',[{opacity:.5},{opacity:1}],{duration:160});
  const query = (document.getElementById('pricing-search-input')?.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('.pricing-row');
  rows.forEach(r => {
    const s = r.getAttribute('data-search').toLowerCase();
    r.style.display = !query || s.includes(query) ? '' : 'none';
  });
  document.getElementById('pricing-empty-row')?.remove();
  if (rows.length && ![...rows].some(row => row.style.display !== 'none')) {
    const row = document.getElementById('pricing-table-body').insertRow();
    row.id = 'pricing-empty-row';
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.appendChild(emptyState('没有匹配的模型或厂商', '清除搜索', () => {
      document.getElementById('pricing-search-input').value = '';
      filterPricingTable();
    }));
  }
}

// Initial Load
export { togglePricingModal, loadPricingMatrix, renderPricingTable, filterPricingTable };
