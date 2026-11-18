import { cancelAnimation, disposeMotion, getMotionPolicy, highlightChange, replaceAnimation, revealGroup, setText, visible } from './motion.js';
import { state } from './state.js';
// Helper for dynamic local date string YYYY-MM-DD
function getLocalDateStr(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Application State

function compactDisplayPath(path) {
  const display = String(path || '').replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '').replace(/\\/g, '/');
  const parts = display.split('/').filter(Boolean);
  if (parts.length <= 3) return display || '未记录工作目录';
  const prefix = display.startsWith('//') ? `//${parts.slice(0, 2).join('/')}` : display.startsWith('/') ? '' : parts[0];
  return `${prefix}/…/${parts.slice(-2).join('/')}`;
}
function calendarTimeline(timeline) {
  if (!timeline.length) return [];
  const known = new Map(timeline.map(day => [day.date, day]));
  const allDates = (state.cachedData?.timeline || timeline).map(day => day.date).sort();
  const from = state.startDate && state.startDate > allDates[0] ? state.startDate : allDates[0];
  const to = state.endDate && state.endDate < allDates.at(-1) ? state.endDate : allDates.at(-1);
  const result = [];
  for (const date = new Date(`${from}T12:00:00Z`); date.toISOString().slice(0, 10) <= to; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    result.push(known.get(key) || {
      date: key,
      missing: true
    });
  }
  return result;
}
function renderSparkline(id, values) {
  const host = document.getElementById(id);
  if (!host) return;
  const valid = values.filter(Number.isFinite);
  if (!valid.length) {
    host.replaceChildren();
    delete host.dataset.sparklineSignature;
    return;
  }
  const max = Math.max(...valid),
    min = Math.min(0, ...valid),
    span = max - min || 1;
  let path = '',
    penDown = false;
  let dots = '';
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = values.length === 1 ? 100 : index * 200 / (values.length - 1);
    const y = 22 - (value - min) / span * 19;
    path += `${penDown ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    if (!Number.isFinite(values[index - 1]) && !Number.isFinite(values[index + 1])) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.7" fill="currentColor"/>`;
    penDown = true;
  });
  const signature=path+dots;
  if (host.dataset.sparklineSignature===signature) return;
  host.dataset.sparklineSignature=signature;
  const first = !host.querySelector('svg');
  reconcileMarkup(host, `<svg viewBox="0 0 200 26" preserveAspectRatio="none" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/>${dots}</svg>`, { enter: false, exit: false });
  const line = host.querySelector('path');
  if (first && line) {
    const length = line.getTotalLength();
    replaceAnimation(line,'draw',[{strokeDasharray:`${length}`,strokeDashoffset:`${length}`},{strokeDasharray:`${length}`,strokeDashoffset:'0'}],{duration:400});
  } else replaceAnimation(host,'sparkline',[{opacity:.5},{opacity:1}],{duration:180});
}
function renderPagination(kind, total, render) {
  const pageState = state.pagination[kind];
  const pages = Math.max(1, Math.ceil(total / pageState.size));
  pageState.page = Math.min(pageState.page, pages);
  const host = document.getElementById(`${kind === 'table' ? 'table' : kind}-pagination`);
  if (!host) return;
  const next = document.createElement('nav');
  host.hidden = total === 0;
  const info = document.createElement('span');
  info.className = 'pagination-summary';
  info.setAttribute('aria-live', 'polite');
  info.textContent = `共 ${total} 条 · 第 ${pageState.page} / ${pages} 页`;
  next.appendChild(info);
  for (const [label, step] of [['上一页', -1], ['下一页', 1]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = step < 0 ? pageState.page === 1 : pageState.page === pages;
    button.dataset.page = pageState.page + step;
    button.onclick = () => {
      pageState.page += step;
      const list = document.getElementById(kind === 'table' ? 'table-body' : kind === 'projects' ? 'projects-grid' : 'studio-grid');
      render();
      replaceAnimation(list,'pagination',[{opacity:.15,transform:'scale(.99)'},{opacity:1,transform:'none'}],{duration:320});
      host.querySelector(`button[data-page="${pageState.page + step}"]`)?.focus();
    };
    button.dataset.key = `page-${step}`;
    next.appendChild(button);
  }
  reconcileCards(host,[...next.children],{enter:false,exit:false});
}
function emptyState(message, action, handler) {
  const wrapper = document.createElement('div');
  wrapper.className = 'empty-state';
  wrapper.dataset.key = 'empty';
  const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('viewBox','0 0 32 28'); icon.setAttribute('aria-hidden','true'); icon.classList.add('empty-state-icon');
  const outline = document.createElementNS('http://www.w3.org/2000/svg','path');
  outline.setAttribute('d','M4 8h9l3-4h12v20H4V8Zm7 8h10M16 11v10');
  outline.setAttribute('pathLength','1'); icon.appendChild(outline); wrapper.appendChild(icon);
  const text = document.createElement('p');
  text.textContent = message;
  wrapper.appendChild(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary';
    button.textContent = action;
    button.onclick = handler;
    wrapper.appendChild(button);
  }
  return wrapper;
}

// Patch by business identity, retaining descendants, focus, decoded images and controls.
function nodeKey(node, index) {
  if (node.nodeType !== 1) return `text:${index}`;
  return node.getAttribute('data-key') || node.id || `${node.tagName}:${node.classList[0] || ''}:${index}`;
}
function patchElement(target, source) {
  if (target.nodeType === 3) {
    if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
    return;
  }
  if (target.nodeType !== 1) return;
  const runtimeStyles = [...target.style].filter(name=>/^--(?:pointer|tilt|selection)-/.test(name)).map(name=>[name,target.style.getPropertyValue(name)]);
  const imageWrap = target.matches('.studio-img-wrap,.today-strip-thumb,.gallery-img-wrap');
  const oldImage = imageWrap ? target.querySelector('img') : null;
  const newImage = imageWrap ? source.querySelector('img') : null;
  const sameImage = oldImage && newImage && oldImage.getAttribute('src') === newImage.getAttribute('src');
  if (sameImage) source.classList.toggle('is-image-loading', target.classList.contains('is-image-loading'));
  if (target.matches('.studio-dimensions') && target.textContent && !source.textContent) return;
  for (const attr of [...target.attributes]) {
    if (attr.name.startsWith('data-motion-') || ['data-pointer','data-final-value'].includes(attr.name)) continue;
    if (!source.hasAttribute(attr.name)) target.removeAttribute(attr.name);
  }
  for (const attr of source.attributes) {
    if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value);
  }
  for (const [name,value] of runtimeStyles) target.style.setProperty(name,value);
  for (const event of ['onclick','onkeydown','onpointerenter','onpointerleave','onfocus','onblur']) {
    if (source[event] && !source.hasAttribute(event.slice(2))) target[event] = source[event];
  }
  if (sameImage) {
    oldImage.alt = newImage.alt;
    return;
  }
  const oldText = target.textContent;
  reconcileNodes(target, [...source.childNodes]);
  if (oldText !== target.textContent && target.matches('.font-mono,.project-rank,.view-tab-badge,.roi-badge,.insights-badge,.quota-basis')) highlightChange(target);
  else if (oldText !== target.textContent && target.matches('.btn-chip,.btn-toggle')) replaceAnimation(target,'label',[{opacity:.5},{opacity:1}],{duration:160});
}
function reconcileNodes(container, nodes) {
  const oldNodes = [...container.childNodes];
  const old = new Map(oldNodes.map((node,index) => [nodeKey(node,index),node]));
  const keep = new Set();
  nodes.forEach((newNode,index) => {
    const key = nodeKey(newNode,index), existing = old.get(key);
    let node = existing && existing.nodeName === newNode.nodeName ? existing : newNode;
    if (node !== newNode) patchElement(node,newNode);
    keep.add(node);
    if (container.childNodes[index] !== node) container.insertBefore(node,container.childNodes[index] || null);
  });
  for (const node of oldNodes) if (!keep.has(node)) { disposeMotion(node); node.remove(); }
}
function capturePositions(container) {
  return new Map([...container.children].filter(visible).map(node => [node, node.getBoundingClientRect()]));
}
function animatePositions(container, positions) {
  const after = [...container.children].filter(visible).map(node => [node,node.getBoundingClientRect()]);
  for (const [node,to] of after) {
    const from = positions.get(node);
    if (from && Math.abs(from.top-to.top) + Math.abs(from.left-to.left) > 1) replaceAnimation(node,'layout',[
      {opacity:.3,transform:'scale(.98)'},{opacity:1,transform:'none'}
    ],{duration:280});
  }
}
function reconcileCards(container, cards, { enter = true, exit = true } = {}) {
  if (!container) return;
  const old = new Map([...container.children].map(node => [node.dataset.key,node]));
  const positions = getMotionPolicy().enabled ? capturePositions(container) : new Map();
  for (const card of container.children) { cancelAnimation(card,'layout'); cancelAnimation(card,'enter'); }
  const keep = new Set(), added = [];
  cards.forEach((newCard,index) => {
    let card = old.get(newCard.dataset.key) || newCard;
    if (card !== newCard) patchElement(card,newCard);
    else added.push(card);
    keep.add(card);
    if (container.children[index] !== card) container.insertBefore(card,container.children[index] || null);
  });
  let exits = 0;
  for (const card of [...container.children]) if (!keep.has(card)) {
    const rect = positions.get(card);
    if (exit && rect && exits++ < 6) {
      const ghost = card.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      ghost.classList.add('motion-ghost');
      ghost.setAttribute('aria-hidden','true'); ghost.inert = true;
      Object.assign(ghost.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
      if (card.matches('tr')) {
        ghost.style.display='grid';
        ghost.style.gridTemplateColumns=[...card.cells].map(cell=>`${cell.getBoundingClientRect().width}px`).join(' ');
      }
      let layer = document.querySelector('.motion-exit-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'motion-exit-layer'; layer.setAttribute('aria-hidden','true'); layer.inert = true;
        document.body.appendChild(layer);
      }
      layer.appendChild(ghost);
      const animation = replaceAnimation(ghost,'exit',[{opacity:.65},{opacity:0}],{duration:140});
      const removeGhost = () => { ghost.remove(); if (!layer.childElementCount) layer.remove(); };
      if (animation) animation.finished.then(removeGhost,removeGhost); else removeGhost();
    }
    disposeMotion(card); card.remove();
  }
  animatePositions(container,positions);
  if (enter) added.filter(visible).slice(0,8).forEach((card,index) => {
    card.dataset.motionEntered='true';
    replaceAnimation(card,'enter',[
      {opacity:0,transform:'scale(.97)'},{opacity:1,transform:'none'}
    ],{duration:360,delay:getMotionPolicy().full ? Math.min(220,index*55) : 0,fill:'backwards'});
  });
}
// Markup is authored by our renderers, with external values escaped at the boundary.
function reconcileMarkup(container, markup, options = {}) {
  if (typeof container === 'string') container = document.getElementById(container);
  if (!container) return;
  const template = document.createElement(container.tagName);
  template.innerHTML = markup;
  const nodes = [...template.children];
  nodes.forEach((node,index) => {
    if (!node.dataset.key) node.dataset.key = node.id || `${node.tagName}:${node.classList[0] || ''}:${index}`;
  });
  reconcileCards(container,nodes,options);
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
  if (cost == null || !Number.isFinite(Number(cost))) return '—';
  if (cost > 0 && cost < 0.005) return '<$0.01';
  return '$' + Number(cost).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// 安全: 本地日志/文件名/模型名均可能含尖括号等字符，innerHTML 渲染前统一转义
function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Fetch and load dashboard data

function animateDisclosure(element, expanded, { fromHeight } = {}) {
  const startHeight = fromHeight ?? (expanded ? 0 : element.getBoundingClientRect().height);
  cancelAnimation(element,'disclosure');
  element.style.display = 'block';
  element.style.overflow = 'hidden';
  const maxHeight = parseFloat(getComputedStyle(element).maxHeight);
  const endHeight = expanded ? Math.min(element.scrollHeight,Number.isFinite(maxHeight) ? maxHeight : Infinity) : 0;
  const animation = replaceAnimation(element,'disclosure',[
    {height:`${startHeight}px`,opacity:expanded ? .2 : 1},
    {height:`${endHeight}px`,opacity:expanded ? 1 : 0}
  ],{duration:expanded ? 220 : 160});
  element._disclosureAnimation = animation;
  if (expanded) revealGroup(element);
  const finish = () => {
    if (element._disclosureAnimation !== animation) return;
    element.style.display = expanded ? 'block' : 'none';
    element.style.overflow = ''; element.style.height = '';
    element._disclosureAnimation = null;
  };
  if (animation) animation.finished.then(finish,finish); else finish();
}
export { patchElement, reconcileMarkup, capturePositions, animatePositions, getLocalDateStr, compactDisplayPath, calendarTimeline, renderSparkline, renderPagination, emptyState, reconcileCards, formatTokens, formatUSD, esc, animateDisclosure };
