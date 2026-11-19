"""Capture the real candidate UI using only synthetic local log metadata."""
import sys
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

folder=Path(sys.argv[2]).resolve()
version=json.loads((Path(__file__).resolve().parents[1]/'package.json').read_text(encoding='utf-8'))['version']
folder.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':1440,'height':1050},locale='zh-CN',timezone_id='Asia/Shanghai',reduced_motion='reduce')
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(sys.argv[1],wait_until='domcontentloaded')
    page.wait_for_function("appState.cachedData?.meta.sourceSelectionMode === 'selected-agents' && appState.cachedData.totals.totalTokens > 0",timeout=30000)
    page.evaluate("""version => {
      const badge=document.createElement('div');
      badge.textContent=version+' · 演示数据 / Synthetic logs · 北京参考';
      badge.style.cssText='position:fixed;bottom:10px;right:16px;z-index:10000;background:#10243f;color:white;padding:8px 14px;border-radius:8px;font:12px system-ui;pointer-events:none';
      document.body.append(badge);
    }""",version)
    page.locator('#btn-view-timeline').click()
    expect(page.locator('#view-timeline')).to_be_visible()
    page.wait_for_function("!!appState.chartInstance")
    page.screenshot(path=str(folder/'dashboard-preview.png'))
    page.locator('#btn-view-today').click()
    expect(page.locator('#view-today')).to_be_visible()
    expect(page.locator('#today-stat-cost')).not_to_have_text('--')
    page.screenshot(path=str(folder/'today-dashboard-preview.png'),full_page=True)
    page.locator('#btn-view-timeline').click()
    page.locator('#dashboard-settings summary').click()
    page.locator('#btn-pricing-matrix').click()
    expect(page.locator('.pricing-row').first).to_be_visible()
    page.locator('#pricing-search-input').fill('qwen3.8')
    expect(page.locator('.pricing-row[data-key="qwen3.8-max"]')).to_contain_text('cn-beijing')
    page.screenshot(path=str(folder/'pricing-matrix-preview.png'))
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors,errors
    print(f'Captured three real candidate views from synthetic local logs: {folder}')
    browser.close()
