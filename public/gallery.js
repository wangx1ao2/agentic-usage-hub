import { highlightChange, replaceAnimation, setBusy } from './motion.js';
import { requestJSON } from './api.js';
import { state } from './state.js';
import { emptyState, esc, formatTokens, formatUSD, getLocalDateStr, reconcileMarkup, reconcileCards, renderPagination } from './utils.js';
import { animateValue, hideOverlay, openLightbox, showOverlay } from './experience.js';
import { refreshData, switchViewMode } from './app.js';
function handleThumbnailError(image) {
  image.parentElement.classList.remove('is-image-loading');
  if (image.parentElement.querySelector('.thumbnail-error-box')) return;
  image.hidden = true;
  const error = document.createElement('div');
  error.className = 'thumbnail-error-box';
  const message = document.createElement('span');
  message.textContent = '图像暂不可用';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'thumbnail-retry';
  retry.textContent = '重试';
  retry.onclick = event => {
    event.stopPropagation();
    error.remove();
    image.hidden = false;
    image.parentElement.classList.add('is-image-loading');
    const source = new URL(image.src);
    source.searchParams.set('retry', String(Date.now()));
    image.src = source.href;
  };
  error.append(message, retry);
  image.parentElement.appendChild(error);
  replaceAnimation(error,'image-error',[{opacity:0},{opacity:1}],{duration:160});
}
async function handleThumbnailLoad(image) {
  const source = image.src;
  try { await image.decode(); } catch (_) {}
  if (image.src !== source || !image.isConnected) return;
  replaceAnimation(image,'image-load',[{opacity:.15},{opacity:1}],{duration:180});
  image.parentElement.classList.remove('is-image-loading');
  const dimensions = image.closest('.studio-card')?.querySelector('.studio-dimensions');
  if (dimensions && image.naturalWidth > 0 && image.naturalHeight > 0) {
    dimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
    dimensions.title = '原图像素尺寸';
    dimensions.hidden = false;
  }
}

// 7. Codex Image Gallery Modal
function openImageGallery() {
  const modal = document.getElementById('image-gallery-modal');
  if (!modal || !state.cachedData || !state.cachedData.imageAnalysis) return;
  const imgData = state.cachedData.imageAnalysis;
  const totals = imgData.totals;
  const elCnt = document.getElementById('gal-total-count');
  const elCost = document.getElementById('gal-total-cost');
  const elTok = document.getElementById('gal-total-tokens');
  const elToday = document.getElementById('gal-today-count');
  if (elCnt) elCnt.innerText = `${totals.totalCount} 张`;
  if (elCost) elCost.innerText = '≈' + formatUSD(totals.totalCost);
  if (elTok) elTok.innerText = totals.formattedTokens;
  if (elToday) elToday.innerText = `${totals.todayCount} 张`;
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;
  const nextCards=[];
  const images = imgData.recentImages || [];
  images.slice(0, 24).forEach((img, index) => {
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.key=img.filePath;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `预览 ${img.prompt || '生成图像'}`);
    const imgSrc = `/api/codex-image?path=${encodeURIComponent(img.filePath)}`;
    card.innerHTML = `
      <div class="gallery-img-wrap is-image-loading">
        <img class="gallery-img-thumb" src="${imgSrc}" loading="lazy" alt="${esc(img.prompt || '生成图像')}" onload="handleThumbnailLoad(this)" onerror="handleThumbnailError(this)">
      </div>
      <div class="gallery-card-info">
        <div class="gallery-date-badge">${img.date} · ${esc(img.fileSize)}</div>
        <div class="gallery-prompt" title="${esc(img.prompt)}">${esc(img.prompt)}</div>
      </div>
    `;
    card.onclick = event => {
      event.currentTarget.focus({
        preventScroll: true
      });
      openLightbox(images, index);
    };
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        card.onclick(event);
      }
    };
    card.style.cursor = 'pointer';
    nextCards.push(card);
  });
  if (!images.length) nextCards.push(emptyState('暂无本地生图资产', '重新扫描', refreshData));
  if (images.length > 24 || totals.totalCount > images.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn-secondary';
    more.textContent = `查看全部 ${totals.totalCount} 张作品`;
    more.onclick = () => {
      hideOverlay('image-gallery-modal');
      switchViewMode('gallery');
    };
    more.dataset.key='more';
    nextCards.push(more);
  }
  reconcileCards(grid,nextCards);
  showOverlay('image-gallery-modal');
}
function closeImageGallery(e) {
  if (e && e.target !== document.getElementById('image-gallery-modal') && !e.target.classList.contains('modal-close-btn')) {
    return;
  }
  const modal = document.getElementById('image-gallery-modal');
  if (modal) hideOverlay('image-gallery-modal');
}

// 8. Studio Gallery Full View Mode

function renderStudioGallery() {
  if (!state.cachedData || !state.cachedData.imageAnalysis) return;
  const imgData = state.cachedData.imageAnalysis;
  const totals = imgData.totals;
  const daily = imgData.daily || [];
  const recent = imgData.recentImages || [];
  const needsCatalog = totals.totalCount > recent.length;
  const rawImages = state.galleryCatalog || recent;
  if (needsCatalog && !state.galleryCatalog && !state.galleryCatalogRequest && !state.galleryCatalogError) loadGalleryCatalog();
  const catalogStatus = document.getElementById('gallery-catalog-status');
  if (catalogStatus) {
    catalogStatus.hidden = !needsCatalog || !!state.galleryCatalog;
    catalogStatus.replaceChildren();
    if (!catalogStatus.hidden) {
      const text = document.createElement('span');
      text.textContent = state.galleryCatalogError ? `完整图片索引读取失败，暂显示最近 ${recent.length} 张。` : `正在读取完整图片索引，暂显示最近 ${recent.length} 张…`;
      catalogStatus.appendChild(text);
      if (state.galleryCatalogError) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn-secondary';
        retry.textContent = '重试完整索引';
        retry.onclick = () => {
          state.galleryCatalogError = '';
          renderStudioGallery();
        };
        catalogStatus.appendChild(retry);
      }
    }
  }
  const todayStr = state.cachedData.meta?.today || getLocalDateStr();
  const shortToday = todayStr.slice(5);

  // 1. Update Hero Stats
  const elTotal = document.getElementById('gal-stat-total');
  const elCost = document.getElementById('gal-stat-cost');
  const elTokens = document.getElementById('gal-stat-tokens');
  const elToday = document.getElementById('gal-stat-today');
  animateValue('gal-stat-total', totals.totalCount, value => `${Math.round(value)} 张`);
  animateValue('gal-stat-cost', totals.totalCost, value => '≈' + formatUSD(value));
  animateValue('gal-stat-tokens', totals.totalTokens, formatTokens);
  animateValue('gal-stat-today', totals.todayCount, value => `${Math.round(value)} 张`);
  document.getElementById('gallery-cost-hint').textContent = `文件数 × 每张参考 ${totals.totalCount ? '$' + (totals.totalCost / totals.totalCount).toFixed(3) : '—'} · 不计入合计；真实费用未记录`;

  // 2. Render Fast Date Filter Chips
  const dateChipsContainer = document.getElementById('gallery-date-chips');
  if (dateChipsContainer) {
    let chipsHtml = `
      <span class="chip-label">快捷日期:</span>
      <button data-key="all" class="btn-chip ${state.gallerySelectedDate === 'all' ? 'active' : ''}" onclick="setGalleryDate('all')">全部 (${totals.totalCount})</button>
      <button data-key="today" class="btn-chip ${state.gallerySelectedDate === 'today' ? 'active' : ''}" onclick="setGalleryDate('today')">今日 ${shortToday} (${totals.todayCount})</button>
    `;

    // Pick top historical dates
    const topDays = [...daily].sort((a, b) => b.count - a.count).slice(0, 5);
    for (const d of topDays) {
      if (d.date !== todayStr) {
        const shortDate = d.date.slice(5);
        chipsHtml += `<button data-key="${esc(d.date)}" class="btn-chip ${state.gallerySelectedDate === d.date ? 'active' : ''}" onclick="setGalleryDate('${d.date}')">${shortDate} (${d.count}张)</button>`;
      }
    }
    reconcileMarkup(dateChipsContainer,chipsHtml,{enter:false,exit:false});
  }

  // 3. Filter Images
  const kw = (state.gallerySearchQuery || '').toLowerCase().trim();
  let filtered = rawImages.filter(img => {
    if (state.gallerySelectedDate === 'today' && img.date !== todayStr) return false;
    if (state.gallerySelectedDate !== 'all' && state.gallerySelectedDate !== 'today' && img.date !== state.gallerySelectedDate) return false;
    if (kw) {
      const matchPrompt = (img.prompt || '').toLowerCase().includes(kw);
      const matchDate = (img.date || '').includes(kw);
      const matchPath = (img.filePath || '').toLowerCase().includes(kw);
      if (!matchPrompt && !matchDate && !matchPath) return false;
    }
    return true;
  });
  document.getElementById('gallery-results-summary').textContent = `${filtered.length} 张匹配 · ${state.gallerySelectedDate === 'all' ? '全部日期' : state.gallerySelectedDate === 'today' ? todayStr : state.gallerySelectedDate}${needsCatalog && !state.galleryCatalog ? ' · 完整索引读取中' : state.galleryCatalog ? ' · 完整索引已就绪' : ''}`;

  // 4. Render Studio Grid
  const grid = document.getElementById('studio-grid');
  if (!grid) return;
  setGalleryFit(state.galleryFitMode, false);
  renderPagination('gallery', filtered.length, renderStudioGallery);
  const nextCards = [];
  if (filtered.length === 0) {
    grid.replaceChildren(emptyState(kw || state.gallerySelectedDate !== 'all' ? '没有匹配的图像或 Prompt' : '暂无本地生图资产', kw || state.gallerySelectedDate !== 'all' ? '清除筛选' : '重新扫描图像', () => {
      state.gallerySearchQuery = '';
      document.getElementById('gallery-search-input').value = '';
      setGalleryDate('all');
      if (!rawImages.length) refreshData();
    }));
    return;
  }
  const offset = (state.pagination.gallery.page - 1) * state.pagination.gallery.size;
  filtered.slice(offset, offset + state.pagination.gallery.size).forEach((img, pageIndex) => {
    const card = document.createElement('div');
    card.className = 'studio-card';
    card.dataset.key = img.filePath;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `预览 ${img.prompt || '生成图像'}`);
    const imgSrc = `/api/codex-image?path=${encodeURIComponent(img.filePath)}`;
    const filename = img.filePath.split(/[\\/]/).at(-1);
    const fileLabel = filename.length > 28 ? filename.slice(0, 14) + '…' + filename.slice(-9) : filename;
    const genericPrompt = !img.prompt || img.prompt === 'Codex 自动化生图工具任务';
    card.setAttribute('aria-label', `预览 ${genericPrompt ? filename : img.prompt}`);
    card.innerHTML = `
      <div class="studio-img-wrap is-image-loading">
        <img class="studio-img-thumb" src="${imgSrc}" loading="lazy" decoding="async" alt="${esc(genericPrompt ? filename : img.prompt)}" onload="handleThumbnailLoad(this)" onerror="handleThumbnailError(this)">
      </div>
      <div class="studio-card-info">
        <div class="studio-meta-row">
          <span class="studio-date-tag">${esc(img.date)}</span>
          <span class="studio-size-tag">${esc(img.fileSize)}</span>
          <span class="studio-dimensions font-mono" hidden></span>
        </div>
        <div class="studio-prompt-text ${genericPrompt ? 'is-filename' : ''}" title="${esc(genericPrompt ? filename : img.prompt)}">${esc(genericPrompt ? fileLabel : img.prompt)}</div>
        ${genericPrompt ? '' : `<div class="studio-filename" title="${esc(filename)}">${esc(filename)}</div>`}
      </div>
    `;
    card.onclick = event => {
      event.currentTarget.focus({
        preventScroll: true
      });
      openLightbox(filtered, offset + pageIndex);
    };
    card.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        card.onclick(event);
      }
    };
    nextCards.push(card);
  });
  reconcileCards(grid, nextCards);
}
function setGalleryFit(mode, persist = true) {
  const previous = state.galleryFitMode;
  state.galleryFitMode = mode === 'cover' ? 'cover' : 'contain';
  const grid = document.getElementById('studio-grid');
  grid.classList.toggle('gallery-fit-contain', state.galleryFitMode === 'contain');
  grid.classList.toggle('gallery-fit-cover', state.galleryFitMode === 'cover');
  for (const value of ['contain', 'cover']) {
    const button = document.getElementById(`gallery-fit-${value}`);
    button.classList.toggle('active', value === state.galleryFitMode);
    button.setAttribute('aria-pressed', String(value === state.galleryFitMode));
  }
  if (persist && previous !== state.galleryFitMode) {
    grid.querySelectorAll('.studio-img-thumb').forEach(image=>replaceAnimation(image,'fit',[{opacity:.35},{opacity:1}],{duration:180}));
  }
  if (persist) {
    try {
      localStorage.setItem('agentic_gallery_fit', state.galleryFitMode);
    } catch (e) {}
  }
}
async function loadGalleryCatalog() {
  const epoch = state.galleryCatalogEpoch;
  const controller = new AbortController();
  state.galleryCatalogRequest = controller;
  setBusy('gallery-catalog-status',true);
  try {
    const result = await requestJSON('/api/codex-images', {
      signal: controller.signal
    });
    if (!Array.isArray(result.images)) throw new Error('图片索引格式无效');
    if (epoch !== state.galleryCatalogEpoch) return;
    state.galleryCatalog = result.images;
    state.galleryCatalogError = '';
  } catch (error) {
    if (error.name === 'AbortError' || epoch !== state.galleryCatalogEpoch) return;
    state.galleryCatalogError = error.message;
  } finally {
    if (epoch === state.galleryCatalogEpoch) {
      state.galleryCatalogRequest = null;
      setBusy('gallery-catalog-status',false);
      if (state.currentMainView === 'gallery') renderStudioGallery();
      if (state.galleryCatalog) highlightChange('gallery-results-summary',200);
    }
  }
}
function setGalleryDate(dateKey) {
  state.pagination.gallery.page = 1;
  state.gallerySelectedDate = dateKey;
  const container = document.getElementById('gallery-date-chips');
  if (container) {
    Array.from(container.querySelectorAll('.btn-chip')).forEach(btn => {
      const onclickAttr = btn.getAttribute('onclick') || '';
      btn.classList.toggle('active', onclickAttr.includes(`'${dateKey}'`));
    });
  }
  renderStudioGallery();
}
function showTodayGallery() {
  state.gallerySelectedDate='today';
  state.gallerySearchQuery='';
  state.pagination.gallery.page=1;
  document.getElementById('gallery-search-input').value='';
  switchViewMode('gallery');
}
function filterGalleryView() {
  state.pagination.gallery.page = 1;
  state.gallerySearchQuery = document.getElementById('gallery-search-input').value;
  renderStudioGallery();
}

// 9. Render Today's Dedicated Live Dashboard
export { showTodayGallery, handleThumbnailError, handleThumbnailLoad, openImageGallery, closeImageGallery, renderStudioGallery, setGalleryFit, loadGalleryCatalog, setGalleryDate, filterGalleryView };
