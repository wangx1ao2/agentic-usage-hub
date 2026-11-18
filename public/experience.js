import { animateNumber, disposeMotion, feedbackButton, getMotionPolicy, highlightChange, replaceAnimation, revealGroup, setText, toggleDetails, visible } from './motion.js';
// Shared interaction helpers. Business data and rendering remain in app.js.
(() => {
  'use strict';
  const reducedMotion = () => !getMotionPolicy().enabled;
  const byId = id => document.getElementById(id);
  const overlayStates = new Map();
  const overlayStack = [];
  const originalInert = new Map();
  const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  let lockedOverflow = null;
  let lightboxImages = [];
  let lightboxIndex = 0;
  let imageRequest = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag = null;
  let thumbnailRect = null;
  let imageDirection = 0;

  window.debounce = (fn, delay = 180) => {
    let timer;
    function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    }
    debounced.cancel = () => clearTimeout(timer);
    return debounced;
  };

  window.animateValue = (id, value, formatter = n => String(Math.round(n)), options = {}) => {
    animateNumber(id, value, formatter, options);
  };

  window.animateView = (element, { direction = 0 } = {}) => {
    if (typeof element === 'string') element = byId(element);
    if (!element) return;
    replaceAnimation(element, 'view', [
      { opacity: .35 }, { opacity: 1 }
    ], { duration: 320 });
    revealGroup(element, { replay: true });
  };

  window.syncViewTabs = mode => {
    const tabs = document.querySelectorAll('.view-tab-btn');
    let active;
    tabs.forEach(tab => {
      const selected = tab.id === `btn-view-${mode}`;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = byId(tab.getAttribute('aria-controls'));
      if (panel) panel.setAttribute('aria-hidden', String(!selected));
      if (selected) active = tab;
    });
    const indicator = document.querySelector('.view-tab-indicator');
    if (active && indicator) {
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      indicator.classList.add('is-ready');
    }
  };

  const visibleFocusable = element => Array.from(element.querySelectorAll(focusableSelector)).filter(node => !node.closest('[inert]') && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  const topOverlay = () => overlayStack[overlayStack.length - 1];
  const restoreInert = () => {
    originalInert.forEach((value, node) => { node.inert = value; });
  };
  const refreshOverlayBackground = () => {
    restoreInert();
    const current = topOverlay();
    if (current) {
      let branch = current;
      while (branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling === branch || sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE') continue;
          if (!originalInert.has(sibling)) originalInert.set(sibling, sibling.inert);
          sibling.inert = true;
        }
        branch = branch.parentElement;
        if (branch === document.body) break;
      }
      if (lockedOverflow === null) lockedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      document.body.classList.add('overlay-open');
    } else {
      originalInert.clear();
      document.body.style.overflow = lockedOverflow ?? '';
      lockedOverflow = null;
      document.body.classList.remove('overlay-open');
    }
  };
  const focusOverlay = overlay => {
    const target = overlay.querySelector('[autofocus], [data-initial-focus]') || visibleFocusable(overlay)[0] || overlay;
    target.focus({ preventScroll: true });
  };
  const overlayCard = overlay => overlay.querySelector('.lightbox-dialog, .pricing-modal-card, .sub-config-modal-card, .modal-content') || overlay.firstElementChild;
  const animateOverlay = (overlay, entering) => {
    if (reducedMotion() || !overlay.animate) return [];
    const duration = entering ? 220 : 140;
    const animations = [replaceAnimation(overlay, 'overlay', entering ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out' })];
    const card = overlayCard(overlay);
    if (card) {
      const sideways = overlay.id === 'pricing-modal';
      const shifted = sideways ? 'translateX(24px)' : 'translateY(8px) scale(.985)';
      animations.push(replaceAnimation(card, 'overlay', entering ? [{ transform: shifted }, { transform: 'none' }] : [{ transform: 'none' }, { transform: shifted }], { duration, easing: 'cubic-bezier(.22,1,.36,1)' }));
    }
    return animations.filter(Boolean);
  };

  window.showOverlay = id => {
    const overlay = typeof id === 'string' ? byId(id) : id;
    if (!overlay) return;
    let state = overlayStates.get(overlay);
    if (state && !state.closing) return;
    if (state) state.animations.forEach(animation => animation.cancel());
    else state = { opener: document.activeElement, animations: [], closing: false, version: 0 };
    state.closing = false;
    state.version++;
    overlayStates.set(overlay, state);
    const oldIndex = overlayStack.indexOf(overlay);
    if (oldIndex >= 0) overlayStack.splice(oldIndex, 1);
    overlayStack.push(overlay);
    overlay.hidden = false;
    overlay.style.display = 'flex';
    overlay.classList.remove('is-closing');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.setAttribute('aria-modal', 'true');
    refreshOverlayBackground();
    state.animations = animateOverlay(overlay, true);
    revealGroup(overlay);
    focusOverlay(overlay);
  };

  window.hideOverlay = async id => {
    const overlay = typeof id === 'string' ? byId(id) : id;
    if (!overlay) return;
    const state = overlayStates.get(overlay);
    if (!state) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      return;
    }
    if (state.closing) return;
    state.closing = true;
    const version = ++state.version;
    state.animations.forEach(animation => animation.cancel());
    overlay.classList.add('is-closing');
    state.animations = animateOverlay(overlay, false);
    if (overlay.id === 'image-lightbox') {
      imageRequest++;
      const image = byId('lightbox-image');
      const selected = lightboxImages[lightboxIndex];
      const destination = [...document.querySelectorAll('.studio-img-thumb,.today-strip-thumb img,.gallery-img-thumb')]
        .find(node => node.getAttribute('src') === imageUrl(selected) && visible(node));
      if (!image.hidden && destination) {
        const from = image.getBoundingClientRect(), to = destination.getBoundingClientRect();
        const animation = replaceAnimation(image, 'image', [
          { opacity: 1, transform: getComputedStyle(image).transform },
          { opacity: .2, transform: `translate(${to.left + to.width / 2 - from.left - from.width / 2 + panX}px,${to.top + to.height / 2 - from.top - from.height / 2 + panY}px) scale(${to.width / image.clientWidth},${to.height / image.clientHeight})` }
        ], { duration: 180 });
        if (animation) state.animations.push(animation);
      }
    }
    await Promise.allSettled(state.animations.map(animation => animation.finished));
    if (state.version !== version) return;
    overlay.style.display = 'none';
    overlay.classList.remove('is-open', 'is-closing');
    overlay.setAttribute('aria-hidden', 'true');
    overlayStates.delete(overlay);
    const stackIndex = overlayStack.indexOf(overlay);
    if (stackIndex >= 0) overlayStack.splice(stackIndex, 1);
    if (overlay.id === 'image-lightbox') imageRequest++;
    refreshOverlayBackground();
    const opener = state.opener;
    if (opener?.isConnected && !opener.closest('[inert]') && opener.getClientRects().length) opener.focus({ preventScroll: true });
    else if (topOverlay()) focusOverlay(topOverlay());
    else document.querySelector('.view-tab-btn.active')?.focus({ preventScroll: true });
  };

  window.setDataStatus = (state, message) => {
    const aliases = { success: 'fresh' };
    state = aliases[state] || state;
    const states = ['loading', 'refreshing', 'fresh', 'stale', 'error', 'empty', 'success'];
    states.forEach(name => document.body.classList.toggle(`data-state-${name}`, name === state));
    document.body.dataset.dataState = state;
    const defaults = { loading: '正在读取本地数据…', refreshing: '正在刷新，保留当前数据', fresh: '数据已更新', stale: '显示上次成功数据', error: '数据读取失败', empty: '暂无日志记录' };
    const status = byId('last-updated');
    if (status) {
      const text = message || defaults[state] || '';
      setText(status, text); status.title = text;
    }
    if (state === 'fresh') { highlightChange(document.querySelector('.live-status'), 260); highlightChange(document.querySelector('.logo-icon'), 350); }
    const today = byId('today-state');
    if (today) today.textContent = ({ loading: '读取中', refreshing: '刷新中', fresh: '已更新', stale: '上次成功数据', error: '读取失败', empty: '暂无记录' })[state] || '等待数据';
    document.querySelectorAll('.view-content').forEach(view => view.setAttribute('aria-busy', String(['loading','refreshing'].includes(state) && view.style.display !== 'none')));
  };

  const imageUrl = image => `/api/codex-image?path=${encodeURIComponent(image.filePath || image.path)}`;
  const updateZoom = (amount, smooth = true) => {
    const image = byId('lightbox-image');
    const from = getComputedStyle(image).transform;
    zoom = Math.max(1, Math.min(4, amount));
    if (zoom === 1) panX = panY = 0;
    const transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    image.style.transform = transform;
    if (smooth) replaceAnimation(image, 'zoom', [{ transform: from }, { transform }], { duration: 160 });
    else { disposeMotion(image); image.style.transform = transform; }
    byId('lightbox-stage').classList.toggle('is-zoomed', zoom > 1);
    byId('lightbox-zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
    byId('lightbox-zoom-out').disabled = zoom <= 1;
    byId('lightbox-zoom-in').disabled = zoom >= 4;
  };

  const renderLightboxImage = (retry = false) => {
    const data = lightboxImages[lightboxIndex];
    if (!data) return;
    const request = ++imageRequest;
    const image = byId('lightbox-image');
    const loading = byId('lightbox-loading');
    const error = byId('lightbox-error');
    const url = imageUrl(data);
    const stage = byId('lightbox-stage');
    updateZoom(1, false);
    if (!image.getAttribute('src')) image.hidden = true;
    error.hidden = true;
    loading.hidden = false;
    stage.setAttribute('aria-busy', 'true');
    byId('lightbox-counter').textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
    byId('lightbox-prev').disabled = lightboxIndex === 0;
    byId('lightbox-next').disabled = lightboxIndex >= lightboxImages.length - 1;
    byId('lightbox-prompt').textContent = data.prompt || '未记录 Prompt';
    byId('lightbox-meta').textContent = [data.date, data.fileSize].filter(Boolean).join(' · ');
    image.alt = data.prompt ? data.prompt.slice(0, 160) : '本地生成图像';
    byId('lightbox-original').href = url;
    const download = byId('lightbox-download');
    download.href = url;
    download.download = (data.filePath || data.path).split(/[\\/]/).pop();
    const probe = new Image();
    probe.onload = async () => {
      try { await probe.decode(); } catch (_) {}
      if (request !== imageRequest) return;
      image.src = probe.src;
      image.hidden = false;
      loading.hidden = true;
      stage.setAttribute('aria-busy', 'false');
      const end = image.getBoundingClientRect();
      if (thumbnailRect && end.width && end.height) {
        const dx = thumbnailRect.left + thumbnailRect.width / 2 - end.left - end.width / 2;
        const dy = thumbnailRect.top + thumbnailRect.height / 2 - end.top - end.height / 2;
        replaceAnimation(image, 'image', [{ opacity: .3, transform: `translate(${dx}px,${dy}px) scale(${thumbnailRect.width / end.width},${thumbnailRect.height / end.height})` }, { opacity: 1, transform: 'none' }], { duration: 260 });
      } else replaceAnimation(image, 'image', [{ opacity: .2, transform: `translateX(${imageDirection * 12}px)` }, { opacity: 1, transform: 'none' }], { duration: 180 });
      thumbnailRect = null;
      imageDirection = 0;
      replaceAnimation(byId('lightbox-prompt'), 'text', [{ opacity: .4 }, { opacity: 1 }], { duration: 160 });
      for (const index of [lightboxIndex - 1, lightboxIndex + 1]) {
        if (lightboxImages[index]) {
          const adjacent = new Image();
          adjacent.src = imageUrl(lightboxImages[index]);
        }
      }
    };
    probe.onerror = () => {
      if (request !== imageRequest) return;
      loading.hidden = true;
      error.hidden = false;
      stage.setAttribute('aria-busy', 'false');
    };
    probe.src = retry ? `${url}&retry=${Date.now()}` : url;
  };

  const stepImage = direction => {
    const next = lightboxIndex + direction;
    if (next < 0 || next >= lightboxImages.length) return;
    lightboxIndex = next;
    imageDirection = direction;
    thumbnailRect = null;
    renderLightboxImage();
  };
  window.openLightbox = (images, index = 0) => {
    if (!Array.isArray(images) || !images.length) return;
    const selected = images[Math.max(0, Math.min(images.length - 1, index))];
    lightboxImages = images.filter(image => image && (image.filePath || image.path));
    if (!lightboxImages.length) return;
    lightboxIndex = Math.max(0, lightboxImages.indexOf(selected));
    const focused = document.activeElement;
    const thumbnail = focused?.matches('img') ? focused : focused?.querySelector('img');
    thumbnailRect = thumbnail?.getBoundingClientRect() || null;
    imageDirection = 0;
    window.showOverlay('image-lightbox');
    renderLightboxImage();
  };

  const setup = () => {
    document.querySelectorAll('[role="dialog"]').forEach(overlay => {
      if (overlay.style.display === 'none') overlay.setAttribute('aria-hidden', 'true');
    });
    const tablist = document.querySelector('[role="tablist"]');
    tablist?.addEventListener('keydown', event => {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      const index = tabs.indexOf(event.target);
      if (index < 0) return;
      const destination = ({ ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 })[event.key];
      if (destination === undefined) return;
      event.preventDefault();
      tabs[destination].focus();
      tabs[destination].click();
    });
    const reposition = () => {
      const active = document.querySelector('.view-tab-btn.active');
      if (active) window.syncViewTabs(active.id.replace('btn-view-', ''));
    };
    window.addEventListener('resize', window.debounce(reposition, 80));
    const syncVisibility = () => document.body.classList.toggle('page-hidden', document.hidden);
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    if (window.ResizeObserver && tablist) new ResizeObserver(reposition).observe(tablist);
    document.fonts?.ready.then(reposition);
    reposition();

    document.addEventListener('keydown', event => {
      const overlay = topOverlay();
      if (!overlay) {
        if (event.key === 'Escape') {
          const settings = byId('dashboard-settings');
          if (settings?.open) {
            toggleDetails(settings, false);
            settings.querySelector('summary').focus();
          }
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        window.hideOverlay(overlay);
      } else if (event.key === 'Tab') {
        const targets = visibleFocusable(overlay);
        const first = targets[0] || overlay;
        const last = targets[targets.length - 1] || overlay;
        if (!targets.length || event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement)) || !event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      } else if (overlay.id === 'image-lightbox' && !event.target.matches('input,textarea,select')) {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          stepImage(event.key === 'ArrowLeft' ? -1 : 1);
        } else if (event.key === '+' || event.key === '=') updateZoom(zoom + .25);
        else if (event.key === '-') updateZoom(zoom - .25);
        else if (event.key === '0') updateZoom(1);
      }
    }, true);
    document.addEventListener('focusin', event => {
      const overlay = topOverlay();
      if (overlay && !overlay.contains(event.target)) focusOverlay(overlay);
    });
    document.addEventListener('pointerdown', event => {
      const settings = byId('dashboard-settings');
      if (settings?.open && !settings.contains(event.target) && !topOverlay()) toggleDetails(settings, false);
      const dates = byId('date-range-popover');
      if (dates?.open && !dates.contains(event.target) && !topOverlay()) toggleDetails(dates, false);
    });
    document.addEventListener('keydown', event => {
      const dates = byId('date-range-popover');
      if (event.key === 'Escape' && dates?.open && !topOverlay()) { toggleDetails(dates, false); dates.querySelector('summary').focus(); }
    });
    byId('lightbox-close').addEventListener('click', () => window.hideOverlay('image-lightbox'));
    byId('image-lightbox').addEventListener('click', event => {
      if (event.target === event.currentTarget) window.hideOverlay('image-lightbox');
    });
    byId('lightbox-prev').addEventListener('click', () => stepImage(-1));
    byId('lightbox-next').addEventListener('click', () => stepImage(1));
    byId('lightbox-zoom-in').addEventListener('click', () => updateZoom(zoom + .25));
    byId('lightbox-zoom-out').addEventListener('click', () => updateZoom(zoom - .25));
    byId('lightbox-zoom-reset').addEventListener('click', () => updateZoom(1));
    byId('lightbox-retry').addEventListener('click', () => renderLightboxImage(true));
    const image = byId('lightbox-image');
    image.addEventListener('pointerdown', event => {
      if (zoom <= 1) return;
      drag = { x: event.clientX, y: event.clientY, panX, panY };
      image.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    image.addEventListener('pointermove', event => {
      if (!drag) return;
      panX = drag.panX + event.clientX - drag.x;
      panY = drag.panY + event.clientY - drag.y;
      updateZoom(zoom, false);
    });
    image.addEventListener('pointerup', () => { drag = null; });
    image.addEventListener('pointercancel', () => { drag = null; });
    byId('lightbox-prompt-copy')?.addEventListener('click', async event => {
      try {
        await navigator.clipboard.writeText(byId('lightbox-prompt').textContent);
        setText('lightbox-action-status', 'Prompt 已复制');
        feedbackButton(event.currentTarget);
      } catch (_) { setText('lightbox-action-status', '无法复制，可直接选中 Prompt 文本'); }
    });
    byId('lightbox-prompt-expand')?.addEventListener('click', event => {
      const expanded = byId('lightbox-prompt').classList.toggle('is-expanded');
      event.currentTarget.setAttribute('aria-expanded', String(expanded));
      event.currentTarget.textContent = expanded ? '收起' : '展开';
    });
    byId('lightbox-download').addEventListener('click', () => setText('lightbox-action-status', '已发起下载，请查看浏览器下载记录'));
    byId('lightbox-original').addEventListener('click', () => setText('lightbox-action-status', '已请求在新窗口打开原图'));
    window.setDataStatus('loading');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();

const { debounce, animateValue, animateView, syncViewTabs, showOverlay, hideOverlay, setDataStatus, openLightbox } = window;
export { debounce, animateValue, animateView, syncViewTabs, showOverlay, hideOverlay, setDataStatus, openLightbox };
