"""Behavioral and visual validation for the native telemetry motion system.

Uses isolated test data; never reads personal logs or submits real exports.
Run: npm run test:motion -- --artifacts output/frontend-motion
"""
import argparse
import asyncio
import copy
import importlib.util
import json
import math
import re
import shutil
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from playwright.async_api import async_playwright, expect

SPEC = importlib.util.spec_from_file_location("dashboard_checks", Path(__file__).with_name("frontend-ui-check.py"))
ui = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ui)


async def motion(page, expression):
    return await page.evaluate("async expression => { const m = await import('/motion.js'); return await new Function('m', 'return (' + expression + ')')(m); }", expression)


async def settle(page, milliseconds=600):
    await page.wait_for_timeout(milliseconds)


async def check_policy(page, stub, results):
    await motion(page, "m.setMotionMode('full')")
    await ui.open_view(page, "projects")
    await settle(page)
    await page.locator("#projects-grid .project-card").first.hover()
    await page.wait_for_function("document.querySelector('#projects-grid .project-card[data-pointer]')")
    await motion(page, "m.setMotionMode('light')")
    assert not (await motion(page, "m.getMotionPolicy()")).get("pointer")
    assert await page.locator("[data-pointer]").count() == 0
    await motion(page, "m.setMotionMode('off')")
    await page.evaluate("animateValue('proj-stat-count', 999, value => String(Math.round(value)))")
    await expect(page.locator("#proj-stat-count")).to_have_text("999")
    assert (await motion(page, "m.motionDiagnostics()"))["numericFrames"] == 0
    animations = await page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length")
    assert animations == 0, f"Disabled motion has {animations} running animations"
    await page.reload()
    await page.wait_for_function("!!window.appState?.cachedData")
    await expect(page.locator("html")).to_have_attribute("data-motion-effective", "off")
    await motion(page, "m.setMotionMode('full')")
    await page.emulate_media(reduced_motion="reduce")
    await expect(page.locator("html")).to_have_attribute("data-motion-effective", "off")
    assert await page.evaluate("document.getAnimations().filter(a=>a.playState==='running').length") == 0
    assert (await motion(page, "m.motionDiagnostics()"))["animations"] == 0
    await page.emulate_media(reduced_motion="no-preference")
    await expect(page.locator("html")).to_have_attribute("data-motion-effective", "full")
    results["policy"] = {"persisted": True, "live_system_preference": True, "off_running_animations": animations}


async def check_interruptions(page, stub, results):
    await page.evaluate("""() => {
      for (let i=0;i<35;i++) { switchViewMode(['today','projects','gallery','timeline'][i%4]); }
      switchViewMode('projects');
      for (let i=0;i<20;i++) setProjectSort(i%2 ? 'cost' : 'active');
      window.__numeric=document.getElementById('proj-stat-count');
      for(let i=1;i<=30;i++) animateValue(__numeric,i,x=>String(Math.round(x)));
    }""")
    await expect(page.locator("#view-projects")).to_be_visible()
    await expect(page.locator("#proj-stat-count")).to_have_text("30")
    await settle(page)
    assert (await motion(page, "m.motionDiagnostics()"))["numericFrames"] == 0
    assert await page.locator(".motion-ghost").count() == 0
    await page.evaluate("animateValue('proj-stat-count',NaN)")
    await expect(page.locator("#proj-stat-count")).to_have_text("—")
    await page.evaluate("animateValue('proj-stat-count',0)")
    await expect(page.locator("#proj-stat-count")).to_have_text("0")
    results["interruptions"] = {"rapid_navigation": 35, "sort_changes": 20, "numeric_targets": 30}
    await ui.open_view(page,'timeline')
    await settle(page)
    await motion(page,"m.setMotionMode('full')")
    sample = await page.evaluate("""async () => {
      const m=await import('/motion.js'), card=document.querySelector('#view-timeline .metric-card');
      const animation=m.replaceAnimation(card,'verification',[{opacity:.2,transform:'translateX(6px)'},{opacity:1,transform:'none'}],{duration:200,easing:'linear'});
      animation.pause();animation.currentTime=100;
      const midpoint={opacity:Number(getComputedStyle(card).opacity),transform:getComputedStyle(card).transform};
      animation.finish();
      return midpoint;
    }""")
    assert .35 < sample['opacity'] < .85, sample
    assert sample['transform'] not in ('none','matrix(1, 0, 0, 1, 0, 0)'),sample
    await motion(page,"m.setMotionMode('off')")
    assert await page.locator('#view-timeline .metric-card').first.evaluate('e=>getComputedStyle(e).opacity') == '1'
    results['native_rendering']={'midpoint':sample,'disabled_returns_final_state':True}


async def check_details(page, stub, results):
    await page.locator("#dashboard-settings > summary").click()
    await expect(page.locator("#dashboard-settings")).to_have_attribute("open", "")
    await page.keyboard.press("Escape")
    await page.locator("#dashboard-settings > summary").click()
    await settle(page, 280)
    assert await page.locator("#dashboard-settings").evaluate("e=>e.open")
    assert not await page.locator(".settings-panel").evaluate("e=>e.inert")
    await page.keyboard.press("Escape")
    await settle(page, 240)
    assert not await page.locator("#dashboard-settings").evaluate("e=>e.open")
    await page.locator(".chart-settings > summary").click()
    await settle(page, 260)
    await page.locator(".chart-settings > summary").click()
    await motion(page, "m.setMotionMode('off')")
    await settle(page, 60)
    assert not await page.locator(".chart-settings").evaluate("e=>e.open")
    assert await page.locator(".chart-settings").evaluate("e=>e.style.height") == ""
    await ui.open_view(page, "projects")
    button = page.locator(".project-expand-btn").first
    await button.click()
    await settle(page, 30)
    await button.click()
    await button.click()
    await settle(page, 260)
    await expect(button).to_have_attribute("aria-expanded", "true")
    results["details"] = {"rapid_reopen": True, "disabled_mid_close": True, "project_final_expanded": True}


async def check_project_identity(page, stub, results):
    await ui.open_view(page, "projects")
    await settle(page)
    await page.evaluate("""() => {
      window.__card=document.querySelector('#projects-grid .project-card');
      window.__key=__card.dataset.key;
      window.__copy=__card.querySelector('.copy-path-btn');
      window.__bar=__card.querySelector('.project-share-meter>span');
      window.__drawer=__card.querySelector('.project-details-drawer');
      __copy.focus();
    }""")
    await page.evaluate("setProjectSort('tokens'); renderProjects()")
    assert await page.evaluate("__card.isConnected && __card.querySelector('.copy-path-btn')===__copy && __card.querySelector('.project-share-meter>span')===__bar && __card.querySelector('.project-details-drawer')===__drawer")
    assert await page.evaluate("document.activeElement===__copy")
    await page.evaluate("toggleProjectDrawer(__key);renderProjects()")
    await settle(page)
    assert await page.evaluate("__drawer.isConnected && __drawer.getAttribute('aria-hidden')==='false'")
    await page.evaluate("""() => {
      const id=document.getElementById('proj-stat-focus').dataset.projectId;
      appState.cachedData.projects.find(project=>project.id===id).lastActive='2000-01-01';
      setProjectSort('active');
    }""")
    await page.locator('#proj-stat-focus').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#projects-pagination')).to_contain_text('第 4 / 4 页')
    assert await page.evaluate("document.activeElement.matches('.project-card') && document.activeElement.dataset.key===document.getElementById('proj-stat-focus').dataset.projectId")
    results["project_identity"] = {"card": True, "descendants": True, "focus": True, "expanded_state": True, "keyboard_locates_focus_project_on_another_page": True}


async def check_chart_events(page, stub, results):
    await page.evaluate("window.__chart=appState.chartInstance;window.__dataset=__chart.data.datasets[0]")
    await page.evaluate("setDatePreset('7d')")
    assert await page.evaluate("appState.chartInstance===__chart && __chart.data.datasets[0]===__dataset")
    await page.evaluate("setAxisMode('tokens')")
    disabled = await page.evaluate("appState.chartInstance.options.animation === false")
    assert disabled, "Cross-unit values must not be numerically morphed"
    await page.evaluate("setChartDimension('model')")
    await settle(page, 220)
    colors = await page.evaluate("appState.chartInstance.data.datasets.map(d=>d.borderColor)")
    legend = page.locator("#chart-legend button").first
    for _ in range(3):
        await legend.focus()
        await page.locator("#axis-tokens").focus()
    assert await page.evaluate("appState.chartInstance.data.datasets.map(d=>d.borderColor)") == colors, "Legend focus corrupts series colors"
    await motion(page, "m.setMotionMode('off')")
    assert await page.evaluate("appState.chartInstance.options.animation===false")
    await motion(page,"m.setMotionMode('full')")
    await settle(page)
    unchanged = await page.evaluate("""() => {
      const host=document.getElementById('stat-cost-sparkline'), svg=host.querySelector('svg');
      renderMetrics(getFilteredTimeline());
      return {same:host.querySelector('svg')===svg,running:host.getAnimations().filter(a=>a.playState==='running').length};
    }""")
    assert unchanged['same'] and unchanged['running']==0,unchanged
    results["chart"] = {"retained_instance": True, "retained_dataset": True, "cross_unit_fade": disabled, "keyboard_legend_colors": True}
    results['chart']['unchanged_sparkline_is_static']=True


async def check_today_identity(page, stub, results):
    await ui.open_view(page, "today")
    await settle(page)
    await page.evaluate("""() => {
      window.__model=document.querySelector('#today-models-list .today-model-item');
      window.__segment=document.querySelector('#today-proportional-bar .today-bar-seg');
      window.__todayImage=document.querySelector('#today-image-strip img');
      window.__mainTokens=document.getElementById('today-stat-tokens');
      __model.focus();renderTodayDashboard();
    }""")
    assert await page.evaluate("__model===document.querySelector('#today-models-list .today-model-item') && __segment===document.querySelector('#today-proportional-bar .today-bar-seg') && __todayImage===document.querySelector('#today-image-strip img')")
    assert await page.evaluate("document.activeElement===__model")
    await page.locator(".today-model-item").first.hover()
    assert await page.locator("#today-proportional-bar").get_attribute("data-model-focus")
    await page.locator("#today-sub-plan-select").select_option("claude_pro")
    assert await page.evaluate("__mainTokens===document.getElementById('today-stat-tokens') && __todayImage===document.querySelector('#today-image-strip img')")
    await page.locator('.today-gallery-preview-header .view-all-link').click()
    await expect(page.locator('#view-gallery')).to_be_visible()
    assert await page.evaluate("appState.gallerySelectedDate==='today' && appState.gallerySearchQuery===''")
    results["today"] = {"model_identity": True, "bar_identity": True, "image_identity": True, "hover_link": True, "subscription_scoped_update": True}
    results['today']['gallery_preserves_today_scope']=True


async def check_live_identity(page, stub, results):
    await ui.open_view(page, "live")
    await expect(page.locator("#codex-live-total")).to_have_text("110")
    await page.locator("#codex-live-toggle").click()
    await settle(page)
    await page.evaluate("window.__row=document.querySelector('#codex-live-sessions tr');window.__cell=__row.cells[5]")
    stub.live_fixture["generatedAt"] += 2000
    stub.live_fixture["totals"]["tokensPerSecond"] = 210
    stub.live_fixture["sessions"][0]["tokensPerSecond"] = 210
    stub.live_fixture["sessions"][0]["lastUsageAt"] += 2000
    await page.locator("#codex-live-refresh").click()
    await expect(page.locator("#codex-live-total")).to_have_text("210")
    assert await page.evaluate("__row===document.querySelector('#codex-live-sessions tr') && __cell===__row.cells[5]")
    assert await page.locator("#codex-live-history").get_attribute("data-samples") == "2"
    path = await page.locator("#codex-live-history path").get_attribute("d")
    assert path.count("M") == 2, "Paused sampling must retain a gap"
    stub.fail_live = True
    await page.locator("#codex-live-refresh").click()
    await expect(page.locator("#codex-live-status")).to_contain_text("更新失败")
    await expect(page.locator("#codex-live-total")).to_have_text("210")
    assert await page.evaluate("__row===document.querySelector('#codex-live-sessions tr')")
    stub.fail_live = False
    stub.live_fixture["generatedAt"] += 2000
    await page.locator("#codex-live-refresh").click()
    await expect(page.locator("#codex-live-history")).to_have_attribute("data-samples", "3")
    path = await page.locator("#codex-live-history path").get_attribute("d")
    assert path.count("M") == 3, "Failed samples must retain a gap"
    image_token = page.locator(".codex-live-image-metrics strong").first
    await expect(image_token).to_have_text("—")
    stub.live_fixture['sourceAvailable']=False
    await page.locator('#codex-live-refresh').click()
    await expect(page.locator('#codex-live-total')).to_have_text('—')
    stub.live_fixture['sourceAvailable']=True
    stub.live_fixture['generatedAt']+=2000
    await page.locator('#codex-live-refresh').click()
    await expect(page.locator('#codex-live-total')).to_have_text('210')
    results["live_identity"] = {"row_and_cell_identity": True, "failure_retains_data": True, "pause_gap": True, "failure_gap": True, "unknown_image_tokens": True, "unavailable_then_same_rate_recovers": True}


async def check_gallery_identity(page, stub, results):
    await ui.open_view(page, "gallery")
    card = page.locator("#studio-grid .studio-card").first
    await card.scroll_into_view_if_needed()
    await page.wait_for_function("!document.querySelector('#studio-grid .studio-img-wrap').classList.contains('is-image-loading')")
    await page.evaluate("window.__image=document.querySelector('#studio-grid img');window.__source=__image.src;window.__dimensions=document.querySelector('.studio-dimensions')")
    await page.evaluate("setGalleryFit('cover');setGalleryFit('contain');renderStudioGallery()")
    assert await page.evaluate("__image===document.querySelector('#studio-grid img') && __image.src===__source && __dimensions===document.querySelector('.studio-dimensions') && !__dimensions.hidden")
    await card.click()
    await expect(page.locator("#lightbox-image")).to_be_visible()
    await page.locator("#lightbox-next").click()
    await page.locator("#lightbox-prev").click()
    await expect(page.locator("#lightbox-counter")).to_have_text("1 / 65")
    await page.locator("#lightbox-zoom-in").click()
    await expect(page.locator("#lightbox-zoom-reset")).to_have_text("125%")
    await page.locator("#lightbox-prompt-expand").click()
    await expect(page.locator("#lightbox-prompt-expand")).to_have_attribute("aria-expanded", "true")
    await page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedPrompt=text;}}})")
    await page.locator("#lightbox-prompt-copy").click()
    assert await page.evaluate("__copiedPrompt===document.getElementById('lightbox-prompt').textContent")
    await page.keyboard.press("Escape")
    await card.click()
    await settle(page)
    await expect(page.locator("#image-lightbox")).to_be_visible()
    await page.keyboard.press("Escape")
    await expect(page.locator("#image-lightbox")).not_to_be_visible()
    await expect(card).to_be_focused()
    async def delayed_image(route):
        await asyncio.sleep(.35 if 'motion-slow' in route.request.url else .02)
        await route.fulfill(content_type='image/png',body=ui.PNG)
    await page.context.route(re.compile(r'/api/codex-image\?'),delayed_image)
    await page.evaluate("openLightbox([{filePath:'motion-slow.png',prompt:'slow'},{filePath:'motion-fast.png',prompt:'fast'}],0)")
    await expect(page.locator('#lightbox-image')).to_be_visible()
    await page.locator('#lightbox-next').click()
    await settle(page,450)
    assert 'motion-fast' in await page.locator('#lightbox-image').get_attribute('src'), 'Late image load replaced the current selection'
    await expect(page.locator('#lightbox-prompt')).to_have_text('fast')
    await page.keyboard.press('Escape')
    results["gallery"] = {"decoded_image_identity": True, "fit_no_reload": True, "rapid_reopen": True, "focus_restored": True, "zoom_and_prompt": True, "prompt_copy_without_system_clipboard": True, "delayed_load_race": True}


async def check_configuration(page, stub, results):
    await ui.open_view(page, "today")
    await page.evaluate("toggleCustomSubModal(true)")
    await expect(page.locator("#sub-config-modal")).to_be_visible()
    await page.locator("#sub-custom-fee").fill("-1")
    await page.evaluate("saveCustomSubscription()")
    await expect(page.locator("#sub-config-error")).to_be_visible()
    await expect(page.locator("#sub-custom-fee")).to_be_focused()
    await page.locator("#sub-custom-fee").fill("25")
    await page.evaluate("saveCustomSubscription()")
    await expect(page.locator("#sub-config-modal")).not_to_be_visible()
    await expect(page.locator("#today-sub-plan-select")).to_have_value("custom")
    await page.locator("#btn-sources").click()
    await expect(page.locator("#sources-rows tr")).to_have_count(1)
    await page.evaluate("window.__sourceRow=document.querySelector('#sources-rows tr')")
    await page.locator("#sources-retry").click()
    await expect(page.locator("#sources-modal")).to_have_attribute("aria-busy", "false")
    assert await page.evaluate("__sourceRow===document.querySelector('#sources-rows tr')")
    await page.keyboard.press("Escape")
    await expect(page.locator("#sources-modal")).not_to_be_visible()
    async with page.expect_download():
        await page.locator("#export-json").click()
    await expect(page.locator("#export-status")).to_contain_text("已生成导出")
    await expect(page.locator("#export-json")).to_have_attribute("aria-busy", "false")
    await ui.open_view(page,'projects')
    await page.locator('[data-project-usage]').first.click()
    await expect(page.locator('#project-usage-rows tr')).to_have_count(50)
    await settle(page,350)
    await page.locator('#project-usage-next').evaluate('e=>e.click()')
    await expect(page.locator('#project-usage-rows tr')).to_have_count(15)
    await expect(page.locator('#project-usage-rows tr').first).to_contain_text('chat-50')
    assert stub.usage_queries[-1]['offset'] == ['50']
    await page.wait_for_function("getComputedStyle(document.getElementById('project-usage-rows')).opacity === '1'")
    await page.locator('#project-usage-prev').evaluate('e=>e.click()')
    await expect(page.locator('#project-usage-rows tr')).to_have_count(50)
    await expect(page.locator('#project-usage-rows tr').first).to_contain_text('chat-0')
    assert stub.usage_queries[-1]['offset'] == ['0']
    await page.wait_for_function("getComputedStyle(document.getElementById('project-usage-rows')).opacity === '1'")
    assert await page.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1")
    results["configuration"] = {"validation_and_recovery": True, "source_row_identity": True, "export_result_feedback": True}
    results['configuration']['request_pagination_data_and_settled_rendering']=True


async def check_background(page, stub, results):
    await ui.open_view(page, "live")
    await expect(page.locator("#codex-live-total")).to_have_text("110")
    await page.evaluate("animateValue('codex-live-total',1000000,x=>String(Math.round(x)))")
    # Deterministic visibility signal, checked separately from real browser tab lifecycle.
    await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
    await settle(page, 100)
    stats = await motion(page, "m.motionDiagnostics()")
    assert stats["animations"] == stats["numericFrames"] == stats["pointerFrames"] == 0, stats
    background_stats = stats
    requests = stub.live_requests
    await settle(page, 2200)
    assert requests == stub.live_requests
    await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
    await expect(page.locator("#codex-live-total")).to_have_text("110")
    await ui.open_view(page, "timeline")
    await settle(page)
    stats = await motion(page, "m.motionDiagnostics()")
    assert stats["numericFrames"] == 0
    results["background"] = {"simulated_visibility": True, "background_live_requests": 0, "background_motion_tasks": background_stats, "resumed_motion_tasks": stats}


async def check_touch(page, stub, results):
    context = await page.context.browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, locale="zh-CN", timezone_id="Asia/Shanghai")
    touch_stub = ui.ApiStub()
    await context.route("**/api/**", touch_stub.handle)
    touch_page = await context.new_page()
    try:
        await ui.ready(touch_page, page.url)
        assert not (await motion(touch_page, "m.getMotionPolicy()")).get("pointer")
        await touch_page.locator("#btn-view-projects").tap()
        await touch_page.locator(".project-card").first.tap(position={"x":50,"y":30})
        assert await touch_page.locator("[data-pointer]").count() == 0
        await settle(touch_page,200)
        assert await touch_page.locator(".project-card").first.evaluate("e=>getComputedStyle(e).translate") in ("none", "0px"), "Touch tap must not leave a sticky hover translation"
        await touch_page.locator("#btn-view-gallery").tap()
        await touch_page.locator(".studio-card").first.tap()
        await expect(touch_page.locator("#image-lightbox")).to_be_visible()
        await touch_page.locator("#lightbox-close").tap()
        await expect(touch_page.locator("#image-lightbox")).not_to_be_visible()
        assert await touch_page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        results["touch"] = {"coarse_pointer": True, "no_hover_tilt": True, "gallery_tap_and_close": True, "no_overflow": True}
    finally:
        await context.close()


async def check_layout_and_artifacts(page, stub, results):
    layouts = []
    for width in (320, 390, 768, 1440):
        await page.set_viewport_size({"width": width, "height": 1000})
        for theme in ("dark", "light"):
            await page.evaluate("theme=>setThemeMode(theme)", theme)
            for view in ui.VIEWS:
                await ui.open_view(page, view)
                box = await page.evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth})")
                assert box["scroll"] <= width + 1, (theme, view, box)
                layouts.append({"width": width, "theme": theme, "view": view})
    results["layout"] = {"cases": len(layouts), "all_no_overflow": True}


async def start_layout_probe(page, milliseconds=1850):
    await page.evaluate("""duration => {
      window.__layoutProbe = {frames: [], done: false};
      const started = performance.now();
      function sample() {
        const root = document.documentElement;
        const button = document.getElementById('btn-refresh');
        const nav = document.querySelector('.main-nav-bar');
        __layoutProbe.frames.push({width: root.scrollWidth, client: root.clientWidth,
          height: root.scrollHeight, x: scrollX, y: scrollY,
          button: button?.getBoundingClientRect().width || 0,
          nav: nav?.getBoundingClientRect().top + scrollY || 0});
        if (performance.now() - started < duration) requestAnimationFrame(sample);
        else __layoutProbe.done = true;
      }
      sample();
    }""", milliseconds)


async def finish_layout_probe(page, label, stable=False):
    await page.wait_for_function('__layoutProbe.done')
    frames = await page.evaluate('__layoutProbe.frames')
    assert len(frames) >= 12, (label, 'Too few animation frames sampled', len(frames))
    assert all(f['width'] <= f['client'] + 1 for f in frames), (label, 'Horizontal overflow during animation',
        [f for f in frames if f['width'] > f['client'] + 1][:3])
    ranges = {key: round(max(f[key] for f in frames) - min(f[key] for f in frames), 2)
              for key in ('width', 'height', 'x', 'y', 'button', 'nav')}
    assert ranges['width'] <= 1, (label, 'Document width changed', ranges)
    if stable:
        assert all(ranges[key] <= 1 for key in ('height','x','y','button','nav')), (label, ranges)
    return {'case': label, 'frames': len(frames), 'range_px': ranges}


async def check_scroll_stability(page, stub, results):
    cases = []
    stub.delay = .65
    await motion(page, "m.setMotionMode('full')")
    for width in (320, 390, 768, 1440):
        await page.set_viewport_size({'width':width, 'height':640})
        # Start the sampler before the delayed first dashboard response.
        await page.reload(wait_until='domcontentloaded')
        await start_layout_probe(page, 1500)
        cases.append(await finish_layout_probe(page, f'{width}-initial-load'))
        for theme in ('dark', 'light'):
            await page.evaluate('theme=>setThemeMode(theme)', theme)
            for view in ui.VIEWS:
                await page.evaluate('view=>switchViewMode(view)', view)
                await settle(page, 700)
                # Refresh away from the top, detecting scrollbar-induced jumps.
                await page.evaluate('scrollTo(0,Math.min(420,document.documentElement.scrollHeight-innerHeight))')
                await start_layout_probe(page)
                await page.evaluate('void refreshData()')
                cases.append(await finish_layout_probe(page, f'{width}-{theme}-{view}-refresh', stable=True))
        print(f'  sampled loading/refresh animation frames at {width}px', flush=True)
    # A tab revisit must visibly animate again, without translating the page.
    await page.set_viewport_size({'width':1440, 'height':1000})
    await page.evaluate("scrollTo(0,0);switchViewMode('projects')")
    await settle(page, 750)
    await page.evaluate("switchViewMode('today');switchViewMode('projects')")
    effects = await page.evaluate("""() => document.getAnimations().filter(a => {
      const e=a.effect?.target;
      return e?.closest?.('#view-projects') && a.playState==='running';
    }).map(a=>({duration:a.effect.getTiming().duration,delay:a.effect.getTiming().delay,
      frames:a.effect.getKeyframes().map(f=>({opacity:f.opacity,transform:f.transform}))}))""")
    assert any(e['duration'] >= 400 and e['delay'] > 0 for e in effects), effects
    assert all(f.get('transform') is None or 'translate' not in f['transform']
               for e in effects for f in e['frames']), effects
    results['scroll_stability'] = {'cases': cases, 'revisited_tab_has_staggered_animation': True}


async def check_live_resources(page, stub, results):
    await page.set_viewport_size({"width":1440,"height":1600})
    await ui.open_view(page, "live")
    await expect(page.locator("#codex-live-total")).to_have_text("110")
    await page.locator("#codex-live-toggle").click()
    await settle(page)
    await page.evaluate("""() => {
      window.__longTasks=[];
      window.__profileRow=document.querySelector('#codex-live-sessions tr');
      new PerformanceObserver(list=>__longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
    }""")
    baseline = await page.locator("#view-live *").count()
    counts, started = [], time.monotonic()
    for index in range(60):
        stub.live_fixture["generatedAt"] += 1000
        output = 10 + (index % 7) * 10
        stub.live_fixture["totals"]["outputTokensPerSecond"] = output
        stub.live_fixture["totals"]["tokensPerSecond"] = 100 + output
        stub.live_fixture["sessions"][0]["outputTokensPerSecond"] = output
        stub.live_fixture["sessions"][0]["tokensPerSecond"] = 100 + output
        stub.live_fixture["sessions"][0]["lastUsageAt"] = stub.live_fixture["generatedAt"]
        await page.locator("#codex-live-refresh").click()
        await expect(page.locator("#codex-live-refresh")).to_be_enabled()
        counts.append(await page.locator("#view-live *").count())
        assert await page.evaluate("__profileRow===document.querySelector('#codex-live-sessions tr')")
        # Keep wall time representative of the supported one-second check frequency.
        await asyncio.sleep(max(0, started + index + 1 - time.monotonic()))
    await settle(page, 800)
    stats = await motion(page, "m.motionDiagnostics()")
    long_tasks = await page.evaluate("__longTasks")
    assert max(counts)-min(counts) <= 2, counts
    assert stats["numericFrames"] == stats["pointerFrames"] == 0
    assert await page.locator("#codex-live-history").get_attribute("data-samples") == "61"
    results["live_60s"] = {"duration_seconds": round(time.monotonic()-started,2), "checks": 60, "data_changes": 59, "session_table_visible": True, "initial_dom_nodes": baseline, "min_dom_nodes": min(counts), "max_dom_nodes": max(counts), "long_tasks_over_50ms": len(long_tasks), "max_long_task_ms": round(max(long_tasks,default=0),2), "motion_after_settle": stats}


CHECKS = [
    ("motion policy and persistence", check_policy),
    ("rapid interruption and numeric correctness", check_interruptions),
    ("disclosure cancellation", check_details),
    ("project node and focus retention", check_project_identity),
    ("chart units and keyboard focus", check_chart_events),
    ("today model and subscription scope", check_today_identity),
    ("live identity gaps and stale data", check_live_identity),
    ("gallery transitions and retained images", check_gallery_identity),
    ("configuration diagnostics and export", check_configuration),
    ("background disposal and resume", check_background),
    ("touch input without hover effects", check_touch),
    ("five view layout matrix", check_layout_and_artifacts),
    ("loading and refresh scroll stability", check_scroll_stability),
    ("sixty second live resource profile", check_live_resources),
]


async def capture_artifacts(browser, args, artifacts):
    """Representative compositions, explicitly labeled as synthetic validation data."""
    folder = artifacts / 'screenshots'
    folder.mkdir(parents=True, exist_ok=True)
    context = await browser.new_context(viewport={"width":1440,"height":1000}, locale="zh-CN", timezone_id="Asia/Shanghai", record_video_dir=str(artifacts/'video'), record_video_size={"width":1440,"height":1000})
    stub = ui.ApiStub()
    fixture = stub.fixture
    target = date(2026,10,18)
    offset = (target - date.fromisoformat(fixture['meta']['today'])).days
    def shift_dates(value):
        if isinstance(value,dict):
            return {key:shift_dates(item) for key,item in value.items()}
        if isinstance(value,list):
            return [shift_dates(item) for item in value]
        if isinstance(value,str) and len(value)==10:
            try: return (date.fromisoformat(value)+timedelta(days=offset)).isoformat()
            except ValueError: pass
        return value
    stub.fixture=fixture=shift_dates(fixture)
    fixture['companies'].append({'name':'Anthropic','label':'Anthropic','color':'#d97706'})
    for index, day in enumerate(fixture['timeline']):
        for model_index, model in enumerate(day['byModel'].values()):
            scale=.65+(math.sin(index*.58+model_index*.3)+1)*.6
            model['cost']=round(model['cost']*scale,4)
            model['tokens']=round(model['tokens']*scale)
        day['byModel']['claude-demo']={'company':'Anthropic','agent':'claude','cost':round(8+math.sin(index*.4)*4,2),'tokens':round(900000+math.sin(index*.4)*250000)}
        day['byCompany']={}
        for model in day['byModel'].values():
            aggregate=day['byCompany'].setdefault(model['company'],{'cost':0,'tokens':0})
            aggregate['cost']+=model['cost']; aggregate['tokens']+=model['tokens']
        day['totalCost']=sum(model['cost'] for model in day['byModel'].values())
        day['totalTokens']=sum(model['tokens'] for model in day['byModel'].values())
        day['cacheReadTokens']=round(day['totalTokens']*.64)
    fixture['todaySummary'].update(copy.deepcopy(fixture['timeline'][-1]))
    stub.catalog_images=copy.deepcopy(fixture['imageAnalysis']['recentImages'])
    for index, project in enumerate(fixture['projects']):
        project['name']=['Usage Hub','Local Index','Agent Workspace','Image Studio'][index%4]+f' {index+1:02}'
    stamp=lambda hour:int(datetime.fromisoformat(f'2026-10-18T{hour:02}:00:00+08:00').timestamp()*1000)
    windows=[{'startsAt':stamp(8),'resetsAt':stamp(13),'displayEndsAt':stamp(13),'usedPercent':100,'quotaObserved':True,'startCovered':True,'apiEquivalentUSD':18.4,'estimatedPer100USD':18.4,'estimateBasis':'recorded100','reached100At':stamp(12),'comparisonUsedPercent':100},
             {'startsAt':stamp(13),'resetsAt':stamp(18),'displayEndsAt':stamp(18),'usedPercent':63,'quotaObserved':True,'startCovered':True,'apiEquivalentUSD':14.2,'estimatedPer100USD':22.54,'estimateBasis':'linear','comparisonUsedPercent':63}]
    fixture['codexQuota']['daily']=[{'date':target.isoformat(),'usedPercent':163,'quotaUnits':1.63,'apiEquivalentUSD':32.6,'averagePer100USD':20,'comparableUsedPercent':163,'completedWindowCount':1,'windows':windows,'quotaObserved':True}]
    async def route(request):
        if '/api/codex-image?' in request.request.url:
            artwork='''<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#0a1d37"/><stop offset="1" stop-color="#145365"/></linearGradient><radialGradient id="h"><stop stop-color="#58d8f5" stop-opacity=".35"/><stop offset="1" stop-color="#58d8f5" stop-opacity="0"/></radialGradient></defs><rect width="960" height="640" fill="url(#g)"/><circle cx="660" cy="250" r="300" fill="url(#h)"/><g fill="none" stroke="#65ddf0" stroke-width="2"><ellipse cx="530" cy="310" rx="310" ry="110" transform="rotate(-30 530 310)"/><ellipse cx="530" cy="310" rx="310" ry="110" transform="rotate(30 530 310)"/><circle cx="530" cy="310" r="160"/><circle cx="530" cy="310" r="110" stroke-opacity=".3"/></g><path d="M0 500H960M0 540H960M0 580H960" stroke="#719fc7" stroke-opacity=".16"/><text x="54" y="80" fill="#b0d4ed" font-family="monospace" font-size="18">LOCAL GENERATIVE STUDIO</text><text x="54" y="582" fill="#e7f6ff" font-family="monospace" font-size="38">TELEMETRY / 018</text></svg>'''
            await request.fulfill(content_type='image/svg+xml',body=artwork)
        else:
            await stub.handle(request)
    await context.route('**/api/**',route)
    page=await context.new_page()
    video=page.video
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    await ui.ready(page,args.base_url)
    await page.evaluate("""() => {
      const badge=document.createElement('div');badge.textContent='验证夹具 · 非真实用量 / 图像';
      badge.style.cssText='position:fixed;right:12px;bottom:10px;z-index:2147483647;background:#102238e8;color:#bdefff;border:1px solid #416c88;padding:5px 9px;border-radius:5px;font:11px monospace;pointer-events:none';
      document.body.appendChild(badge);
    }""")
    async def shot(name):
        await settle(page,600)
        await page.screenshot(path=str(folder/name))
    for theme in ('dark','light'):
        await page.evaluate('theme=>setThemeMode(theme)',theme)
        for view in ui.VIEWS:
            await ui.open_view(page,view)
            await page.evaluate('scrollTo(0,0)')
            if view=='live' and theme=='dark':
                for index in range(20):
                    stub.live_fixture['generatedAt']+=5000
                    value=round(110+math.sin(index*.7)*65,1)
                    fresh=round(value*.1,1); cache=round(value*.8,1)
                    for key,reading in {'tokensPerSecond':value,'inputTokensPerSecond':fresh,'cacheReadTokensPerSecond':cache,'outputTokensPerSecond':round(value-fresh-cache,1)}.items():
                        stub.live_fixture['totals'][key]=reading
                        stub.live_fixture['sessions'][0][key]=reading
                    stub.live_fixture['sessions'][0]['lastUsageAt']=stub.live_fixture['generatedAt']
                    await page.locator('#codex-live-refresh').evaluate('e=>e.click()')
                    await expect(page.locator('#codex-live-refresh')).to_be_enabled()
            await shot(f'{view}-{theme}-desktop.png')
    await page.evaluate("setThemeMode('dark');switchViewMode('gallery')")
    await page.locator('.studio-card').first.click()
    await shot('gallery-lightbox-desktop.png')
    await page.locator('#lightbox-next').click()
    await settle(page,240)
    await page.keyboard.press('Escape')
    await expect(page.locator('#image-lightbox')).not_to_be_visible()
    await ui.open_view(page,'projects')
    await page.locator('#proj-sort-active').click()
    await page.locator('.project-expand-btn').first.click()
    await settle(page,350)
    await ui.open_view(page,'today')
    await page.locator('.quota-history-panel').scroll_into_view_if_needed()
    await shot('today-quota-desktop.png')
    await page.locator('#dashboard-settings > summary').click()
    await shot('settings-motion-desktop.png')
    await page.keyboard.press('Escape')
    for theme in ('dark','light'):
        await page.set_viewport_size({'width':390,'height':844})
        await page.evaluate('theme=>setThemeMode(theme)',theme)
        for view in ('today','timeline','gallery','live'):
            await ui.open_view(page,view)
            await page.evaluate('scrollTo(0,0)')
            await shot(f'{view}-{theme}-mobile.png')
    await context.close()
    if video:
        shutil.copyfile(await video.path(),artifacts/'motion-demo.webm')
    assert not errors,errors
    return {'screenshots':len(list(folder.glob('*.png'))),'video':'motion-demo.webm','data':'synthetic validation fixtures, labeled on every screenshot','page_errors':errors}


async def run(args):
    results, failures = {}, []
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        for name, check in CHECKS:
            if args.capture_only:
                break
            if args.check and name not in args.check:
                continue
            context = await browser.new_context(viewport={"width":1440,"height":1000}, locale="zh-CN", timezone_id="Asia/Shanghai")
            stub = ui.ApiStub()
            await context.route("**/api/**", stub.handle)
            page = await context.new_page()
            errors, external = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: external.append(request.url) if not request.url.startswith(args.base_url) and not request.url.startswith("data:") else None)
            try:
                await ui.ready(page, args.base_url)
                await check(page, stub, results)
                assert not errors, errors
                assert not external, f"Unexpected external resources: {external}"
                print(f"PASS {name}", flush=True)
            except Exception as error:
                failures.append({"check":name,"error":str(error),"page_errors":errors})
                print(f"FAIL {name}: {error}\n{errors}", flush=True)
                await page.screenshot(path=str(artifacts / (name.replace(" ","-")+"-failure.png")), full_page=True)
            await context.close()
        if args.capture or args.capture_only:
            results['visual_artifacts']=await capture_artifacts(browser,args,artifacts)
        await browser.close()
    report = {"environment":"Chromium headless; isolated API fixtures; Asia/Shanghai", "results":results, "failures":failures}
    output_name='visual-results.json' if args.capture_only else 'motion-results.json'
    (artifacts/output_name).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"{len(results)} result groups, {len(failures)} failed checks. Report: {artifacts/output_name}",flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url",default="http://127.0.0.1:4242")
    parser.add_argument("--artifacts",default="output/frontend-motion")
    parser.add_argument("--check",action="append",choices=[name for name,_ in CHECKS])
    parser.add_argument("--capture",action="store_true",help="Also save representative screenshots and an interaction video")
    parser.add_argument("--capture-only",action="store_true",help="Capture visuals without running the behavioral checks")
    raise SystemExit(asyncio.run(run(parser.parse_args())))
