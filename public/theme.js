import { getMotionPolicy, replaceAnimation } from './motion.js';
import { state } from './state.js';
import { getFilteredTimeline } from './app.js';
import { renderChart } from './timeline.js';
function getEffectiveTheme() {
  if (state.currentThemeMode === 'light') return 'light';
  if (state.currentThemeMode === 'dark') return 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(mode) {
  state.currentThemeMode = mode;
  try {
    localStorage.setItem('agentic_theme_mode', mode);
  } catch (e) {}

  // Update theme toggle buttons UI
  ['auto', 'light', 'dark'].forEach(m => {
    const btn = document.getElementById(`theme-btn-${m}`);
    if (btn) {
      if (m === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
  const effective = getEffectiveTheme();
  document.documentElement.setAttribute('data-theme', effective);

  // If Chart.js instance is present, re-render to update gridlines and tooltips
  if (state.cachedData && state.chartInstance && state.currentMainView === 'timeline') {
    const filteredTimeline = getFilteredTimeline();
    renderChart(filteredTimeline, false);
  }
}
function setThemeMode(mode) {
  const before=getEffectiveTheme();
  applyTheme(mode);
  if (before!==getEffectiveTheme() && getMotionPolicy().enabled) replaceAnimation(document.body,'theme',[{opacity:.82},{opacity:1}],{duration:240});
}
function initTheme() {
  applyTheme(state.currentThemeMode);

  // Auto adapt to system preference changes when in 'auto' mode
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const changeHandler = () => {
      if (state.currentThemeMode === 'auto') {
        applyTheme('auto');
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', changeHandler);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(changeHandler);
    }
  }
}

// Formatters
export { getEffectiveTheme, applyTheme, setThemeMode, initTheme };
