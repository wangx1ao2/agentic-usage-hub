// Native motion primitives. Data is committed synchronously; effects are disposable.
const media = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const animations = new Map();
const channels = new WeakMap();
const numbers = new WeakMap();
const numberTasks = new Set();
const detailsStates = new WeakMap();
const revealed = new WeakSet();
const selectionPositions = new WeakMap();
const ease = 'cubic-bezier(.22,1,.36,1)';
let mode = 'full', pointerFrame = 0, pointerTarget = null, pointerEvent = null;
const effectObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (!entry.isIntersecting) disposeMotion(entry.target);
});
try { mode = localStorage.getItem('agentic_motion_mode') || 'full'; } catch (_) {}
if (!['full', 'light', 'off'].includes(mode)) mode = 'full';

export function getMotionPolicy() {
  const enabled = mode !== 'off' && !media.matches && !document.hidden;
  return { mode, enabled, full: enabled && mode === 'full', pointer: enabled && mode === 'full' && finePointer.matches };
}

export function visible(element) {
  if (!element?.isConnected || !element.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

export function replaceAnimation(element, channel, frames, options = {}) {
  if (!element) return null;
  let active = channels.get(element);
  if (!active) channels.set(element, active = new Map());
  const previous = active.get(channel);
  // Continue interrupted transitions at their currently painted position.
  if (previous && frames.length > 1) {
    const computed = getComputedStyle(element);
    frames = frames.map(frame => ({ ...frame }));
    for (const property of ['transform', 'opacity', 'height']) {
      if (property in frames[0]) frames[0][property] = computed[property];
    }
    previous.cancel();
  }
  if (!getMotionPolicy().enabled || !visible(element) || !element.animate) return null;
  const animation = element.animate(frames, { duration: 180, easing: ease, ...options });
  active.set(channel, animation);
  animations.set(animation, { element, channel });
  effectObserver.observe(element);
  const cleanup = () => {
    animations.delete(animation);
    if (active.get(channel) === animation) active.delete(channel);
    if (!active.size && ![...numberTasks].some(task => task.element === element)) effectObserver.unobserve(element);
  };
  animation.finished.then(cleanup, cleanup);
  return animation;
}

export function cancelAnimation(element, channel) {
  const active = channels.get(element), animation = active?.get(channel);
  if (!animation) return;
  active.delete(channel); animations.delete(animation); animation.cancel();
}

export function disposeMotion(scope = document) {
  for (const [animation, record] of animations) {
    if (scope === document || scope === record.element || scope?.contains(record.element)) {
      try { animation.finish(); } catch (_) {}
      animation.cancel();
      animations.delete(animation);
    }
  }
  for (const task of [...numberTasks]) {
    if (scope === document || scope === task.element || scope?.contains(task.element)) task.finish();
  }
  if (pointerFrame) cancelAnimationFrame(pointerFrame);
  pointerFrame = 0;
  clearPointer();
}

function applyPolicy() {
  const policy = getMotionPolicy();
  document.documentElement.dataset.motion = policy.mode;
  // Visibility pauses CSS timelines; it must not restart the boot sequence on return.
  document.documentElement.dataset.motionEffective = mode !== 'off' && !media.matches ? mode : 'off';
  document.body?.classList.toggle('page-hidden', document.hidden);
  if (!policy.enabled || !policy.pointer) disposeMotion();
  document.querySelectorAll('[data-motion-mode]').forEach(button => {
    const selected = button.dataset.motionMode === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const note = document.getElementById('motion-preference-note');
  if (note) note.textContent = media.matches ? '系统已开启减少动态效果' : mode === 'full' ? '卡片依次入场、切页过渡与数据反馈' : mode === 'light' ? '保留操作反馈，减少装饰' : '直接显示最终状态';
  document.dispatchEvent(new CustomEvent('motionpolicychange', { detail: policy }));
}

export function setMotionMode(value) {
  if (!['full', 'light', 'off'].includes(value)) return;
  disposeMotion();
  mode = value;
  try { localStorage.setItem('agentic_motion_mode', mode); } catch (_) {}
  applyPolicy();
}

export function highlightChange(element, duration = 500) {
  if (typeof element === 'string') element = document.getElementById(element);
  if (!element) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--motion-highlight').trim() || '#58d8f522';
  replaceAnimation(element, 'change', [{ backgroundColor: color }, { backgroundColor: 'transparent' }], { duration });
  if (element.matches('.metric-card,.project-card,.today-roi-card,.logo-icon,.live-status,.panel-card-badge')) {
    replaceAnimation(element,'ring',[{boxShadow:`0 0 0 0 ${color}`},{boxShadow:'0 0 0 6px transparent'}],{duration});
  }
}

export function setText(element, value, { highlight = false } = {}) {
  if (typeof element === 'string') element = document.getElementById(element);
  if (!element) return false;
  const next = String(value ?? '—'), old = element.textContent;
  if (old === next) return false;
  element.textContent = next;
  if (old && old !== '—' && old !== '--') {
    if (highlight) highlightChange(element);
    else replaceAnimation(element, 'text', [{ opacity: .5 }, { opacity: 1 }], { duration: 160 });
  }
  return true;
}

export function animateNumber(element, target, formatter, { duration = 300, reason = 'update' } = {}) {
  if (typeof element === 'string') element = document.getElementById(element);
  if (!element) return;
  const previous = numbers.get(element);
  if (previous?.target === target && previous.formatter === formatter &&
      (previous.frame || element.textContent === (Number.isFinite(target) ? formatter(target) : '—'))) return;
  const from = previous?.value ?? target;
  previous?.finish(false);
  const task = { element, value: from, target, formatter, frame: 0, finish: null };
  const draw = value => { task.value = value; element.textContent = Number.isFinite(value) ? formatter(value) : '—'; };
  task.finish = (commit = true) => {
    cancelAnimationFrame(task.frame);
    task.frame = 0;
    numberTasks.delete(task);
    if (commit) draw(target);
    if (!channels.get(element)?.size) effectObserver.unobserve(element);
  };
  numbers.set(element, task);
  element.dataset.finalValue = Number.isFinite(target) ? formatter(target) : '—';
  if (!duration || !getMotionPolicy().enabled || !visible(element) || !previous || from === target || !Number.isFinite(from) || !Number.isFinite(target)) {
    draw(target);
    return;
  }
  if (reason !== 'resume') highlightChange(element.closest('.metric-card,.today-roi-card,.project-stat-item,.gallery-stat-item') || element, 400);
  const start = performance.now();
  numberTasks.add(task);
  effectObserver.observe(element);
  const tick = now => {
    if (!getMotionPolicy().enabled || !element.isConnected) return task.finish();
    const progress = Math.min(1, (now - start) / Math.max(1, duration));
    draw(from + (target - from) * (1 - (1 - progress) ** 3));
    if (progress < 1) task.frame = requestAnimationFrame(tick);
    else task.finish();
  };
  task.frame = requestAnimationFrame(tick);
}

export function revealGroup(container, { replay = false } = {}) {
  if (!container) return;
  const selector = '.brand,.page-title,.page-description,.page-heading,.timeline-page-header,.today-hero-header,.metric-card,.project-stat-item,.gallery-stat-item,.today-panel-card,.chart-card,.panel-card,.today-roi-card,.project-card,.studio-card,.source-row,.today-model-item,.family-sub-item,.form-group,.empty-state';
  const candidates = [...container.querySelectorAll(selector)].filter(element => {
    const parent = element.parentElement?.closest(selector);
    return !parent || !container.contains(parent);
  });
  let index = 0;
  for (const element of candidates) {
    if ((!replay && revealed.has(element)) || !visible(element)) continue;
    revealed.add(element);
    if (!replay && element.hasAttribute('data-motion-entered')) continue;
    if (index >= (container.matches('.today-more-models') ? 6 : 8)) continue;
    // Scale from inside the final bounds: visible motion without scroll overflow.
    replaceAnimation(element, 'reveal', [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], {
      duration: getMotionPolicy().full ? 420 : 180,
      delay: getMotionPolicy().full ? Math.min(index++ * 55, 220) : 0,
      fill: 'backwards'
    });
  }
}

export function feedbackButton(button, { success = true, label } = {}) {
  if (!button) return;
  button.dataset.feedback = success ? 'success' : 'error';
  button.setAttribute('aria-busy', 'false');
  if (label) button.setAttribute('aria-label', label);
  highlightChange(button, 650);
  // Logical feedback lifetime, independent from animation completion.
  clearTimeout(button._feedbackTimer);
  button._feedbackTimer = setTimeout(() => { delete button.dataset.feedback; }, 1000);
}

export function setBusy(element, busy) {
  if (typeof element === 'string') element = document.getElementById(element);
  if (!element) return;
  element.setAttribute('aria-busy', String(busy));
  element.classList.toggle('motion-busy', busy);
}

export function toggleDetails(details, expanded) {
  if (!details) return;
  const previous = detailsStates.get(details);
  const target = expanded ?? !(previous ? previous.target : details.open);
  const currentHeight = details.getBoundingClientRect().height;
  previous?.animation?.cancel();
  const summary = details.querySelector(':scope > summary');
  summary?.setAttribute('aria-expanded', String(target));
  const body = details.querySelector(':scope > .settings-panel,:scope > .date-range-panel');
  cancelAnimation(body || details,'details');
  const record = { target, animation: null };
  detailsStates.set(details, record);
  if (!details.open) details.open = true;
  const finish = () => {
    if (detailsStates.get(details) !== record) return;
    details.open = target;
    details.style.height = '';
    details.style.overflow = '';
    for (const child of details.children) if (child !== summary) child.inert = !target;
    detailsStates.delete(details);
  };
  for (const child of details.children) if (child !== summary) child.inert = !target;
  if (body) {
    record.animation = replaceAnimation(body, 'details', target ? [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 1 }, { opacity: 0 }], { duration: target ? 180 : 120 });
  } else {
    const fullHeight = details.getBoundingClientRect().height;
    const closedHeight = (summary?.getBoundingClientRect().height || 24) + parseFloat(getComputedStyle(details).paddingTop || 0) + parseFloat(getComputedStyle(details).paddingBottom || 0);
    details.style.overflow = 'clip';
    record.animation = replaceAnimation(details, 'details', [{ height: `${currentHeight}px` }, { height: `${target ? fullHeight : closedHeight}px` }], { duration: target ? 220 : 160 });
  }
  if (record.animation) record.animation.finished.then(finish, finish);
  else finish();
  if (target) revealGroup(details);
}

function clearPointer() {
  if (pointerTarget) {
    pointerTarget.style.removeProperty('--pointer-x');
    pointerTarget.style.removeProperty('--pointer-y');
    pointerTarget.style.removeProperty('--tilt-x');
    pointerTarget.style.removeProperty('--tilt-y');
    pointerTarget.removeAttribute('data-pointer');
  }
  pointerTarget = null;
}

function setup() {
  applyPolicy();
  const syncSelections = () => {
    const groups = [...document.querySelectorAll('.btn-group,.toggle-group,.axis-switch,.chip-group,.agent-tabs,#gallery-date-chips')];
    for (const group of groups) if (!group.classList.contains('motion-selection')) group.classList.add('motion-selection');
    const positions = groups.map(group => {
      const button = group.querySelector(':scope > button.active');
      if (!button || !group.getClientRects().length) return null;
      // Layout coordinates stay stable while a parent card scales into view.
      return { group, left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight };
    }).filter(Boolean);
    for (const item of positions) {
      const signature = `${item.left}:${item.top}:${item.width}:${item.height}`;
      if (selectionPositions.get(item.group) === signature) continue;
      selectionPositions.set(item.group, signature);
      if (!item.group.classList.contains('motion-selection')) item.group.classList.add('motion-selection');
      for (const key of ['left', 'top', 'width', 'height']) item.group.style.setProperty(`--selection-${key}`, `${item[key]}px`);
    }
  };
  let selectionQueued = false;
  const queueSelections = () => {
    if (selectionQueued) return;
    selectionQueued = true;
    queueMicrotask(() => { selectionQueued = false; syncSelections(); });
  };
  new MutationObserver(records => {
    if (records.some(record => record.target.matches('button,.agent-tab,.toggle-group,.axis-switch,.chip-group'))) queueSelections();
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('click', queueSelections);
  window.addEventListener('resize', queueSelections);
  document.fonts?.ready.then(queueSelections);
  syncSelections();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) revealGroup(entry.target);
      else disposeMotion(entry.target);
    }
  });
  document.querySelectorAll('.view-content').forEach(view => observer.observe(view));
  document.addEventListener('click', event => {
    const motionButton = event.target.closest('[data-motion-mode]');
    if (motionButton) setMotionMode(motionButton.dataset.motionMode);
    const summary = event.target.closest('summary');
    if (summary && summary.parentElement.tagName === 'DETAILS' && !event.defaultPrevented) {
      event.preventDefault();
      toggleDetails(summary.parentElement);
    }
    const button = event.target.closest('button:not(:disabled),a.btn-secondary');
    if (button) replaceAnimation(button, 'press', [{ scale: '.98' }, { scale: '1' }], { duration: 120 });
  });
  document.addEventListener('pointermove', event => {
    if (!getMotionPolicy().pointer) return;
    const target = event.target.closest('.metric-card,.project-card,.studio-card,.today-roi-card');
    if (target !== pointerTarget) { clearPointer(); pointerTarget = target; }
    if (!target) return;
    pointerEvent = { x: event.clientX, y: event.clientY };
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!pointerTarget || !getMotionPolicy().pointer) return;
      const rect = pointerTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, pointerEvent.x - rect.left));
      const y = Math.max(0, Math.min(rect.height, pointerEvent.y - rect.top));
      pointerTarget.style.setProperty('--pointer-x', `${x}px`);
      pointerTarget.style.setProperty('--pointer-y', `${y}px`);
      pointerTarget.style.setProperty('--tilt-x', `${(y / rect.height - .5) * -3}deg`);
      pointerTarget.style.setProperty('--tilt-y', `${(x / rect.width - .5) * 3}deg`);
      pointerTarget.dataset.pointer = 'true';
    });
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) clearPointer(); });
  document.addEventListener('focusin', event => {
    const input = event.target.closest('input,select');
    if (input) highlightChange(input, 220);
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[aria-invalid="true"]')) event.target.removeAttribute('aria-invalid');
  });
  replaceAnimation(document.querySelector('.logo-icon path'), 'logo', [{ strokeDasharray: '100', strokeDashoffset: '100' }, { strokeDasharray: '100', strokeDashoffset: '0' }], { duration: 450 });
  revealGroup(document.querySelector('.header'));
  revealGroup(document.querySelector('.view-content:not([style*="display: none"]):not([style*="display:none"])'));
}

media.addEventListener('change', applyPolicy);
finePointer.addEventListener('change', applyPolicy);
document.addEventListener('visibilitychange', applyPolicy);
window.addEventListener('pagehide', () => disposeMotion());
window.addEventListener('pageshow', applyPolicy);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
else setup();

// Read-only diagnostics for lifecycle/performance verification.
export function motionDiagnostics() {
  return { ...getMotionPolicy(), animations: animations.size, numericFrames: numberTasks.size, pointerFrames: pointerFrame ? 1 : 0 };
}
