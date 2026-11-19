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
    const evidence = mVal.pricingEvidence || {};
    const policy = mVal.pricingPolicy || {};
    const expired = policy.validThrough && new Date().toISOString().slice(0,10) > policy.validThrough;
    const unavailable = mVal.unpriced || expired;
    const status = expired ? '参考价已过期' : {
      verified:'已核对', 'legacy-reference':'旧参考价 · 待复核',
      'provider-required':'需指定提供商', 'user-assumption':'个人估算假设', 'region-unavailable':'该地域暂无费率'
    }[evidence.status] || '未核对';
    const reference = /^https:\/\//.test(evidence.source || '')
      ? `<a href="${esc(evidence.source)}" style="white-space:nowrap" target="_blank" rel="noopener noreferrer">来源</a>` : '';
    const limits = [evidence.region, evidence.note, policy.validThrough ? `有效至 ${policy.validThrough}` : '',
      policy.context || policy.inputBands?.length ? '长输入规则按单次请求判断' : '短文本参考价',
      '不含存储、工具、税费和订阅扣费'].filter(Boolean).join('；');
    const rate = (value,digits) => unavailable || typeof value !== 'number' || !Number.isFinite(value)
      ? '暂无费率' : '$' + value.toFixed(digits);
    html += `
      <tr data-key="${esc(mKey)}" class="pricing-row" data-search="${esc(mKey)} ${esc(mVal.label || '')} ${esc(mVal.company || '')}">
        <td>
          <span class="pricing-provider-tag ${compConf.badgeClass || ''}">${esc(mVal.company)}</span>
        </td>
        <td>
          <strong style="color:var(--text-main)">${esc(mVal.label || mKey)}</strong>
          <div style="font-size:11px;color:var(--text-dim);font-family:monospace">${esc(mKey)}</div>
          <div style="font-size:11px;color:var(--text-muted)" title="${esc(limits)}">${esc(status)}${evidence.checkedAt ? ' · ' + esc(evidence.checkedAt) : ''} ${reference}${policy.validThrough ? ' · 至 ' + esc(policy.validThrough) : ''}</div>
          ${evidence.originalCurrency === 'CNY' ? `<div style="font-size:11px;color:var(--text-muted)">${esc(evidence.region)} · CNY ÷ ${esc(evidence.exchangeRateCNYPerUSD)}</div>` : ''}
        </td>
        <td class="font-mono text-emerald">${rate(std.in,2)}</td>
        <td class="font-mono text-blue">${rate(std.out,2)}</td>
        <td class="font-mono text-purple">${rate(std.cache,3)}</td>
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
