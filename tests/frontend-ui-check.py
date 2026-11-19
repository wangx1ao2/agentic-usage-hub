"""Deterministic browser regression checks for the native dashboard UI.

Run an isolated server and these checks with: npm run test:ui
Requires Python Playwright and its Chromium browser; adds no npm dependencies.
Dashboard, live usage, pricing, image catalog, images and refresh requests are
intercepted. Fixtures reproduce the dashboard schema without local log data.
"""

import argparse
import asyncio
import base64
import copy
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright, expect


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJawAAAAASUVORK5CYII="
)
VIEWS = ("today", "live", "timeline", "projects", "gallery")


def make_fixture():
    """Enough rows, projects and images to exercise every pagination boundary."""
    today = date(2026, 10, 13)
    model_specs = [(f"gpt-ui-{i:02d}", i + 1, (10 - i) * 100_000) for i in range(10)]
    timeline = []
    for i in range(45):
        by_model = {
            name: {"cost": cost, "tokens": tokens, "cacheTokens": tokens // 2,
                   "company": "OpenAI", "agent": "codex"}
            for name, cost, tokens in model_specs
        }
        tokens = sum(v[2] for v in model_specs)
        timeline.append({
            "date": (today - timedelta(days=44 - i)).isoformat(),
            "totalCost": 55, "totalTokens": tokens, "cacheReadTokens": tokens // 2,
            "inputTokens": tokens // 3, "outputTokens": tokens // 6, "agents": ["codex"],
            "byCompany": {"OpenAI": {"cost": 55, "tokens": tokens,
                                      "cacheTokens": tokens // 2,
                                      "models": [v[0] for v in model_specs]}},
            "byModel": by_model,
        })
    projects = []
    for i in range(37):
        projects.append({
            "id": f"project_{i:016x}", "name": f"UI project {i:02d}", "icon": "",
            "desc": "Browser regression fixture", "primaryPath": f"F:\\fixture\\project-{i:02d}",
            "paths": [f"F:\\fixture\\project-{i:02d}"], "pathCount": 1,
            "totalTokens": (i + 1) * 1000, "cacheTokens": 0, "totalCost": i + 1,
            "formattedCost": f"${i + 1:.2f}", "formattedTokens": f"{i + 1}k",
            "sessionCount": 1, "agents": ["codex"], "estimated": False,
            "companies": {name: {"tokens": 1000 if name == "openai" else 0,
                                 "cost": 1 if name == "openai" else 0,
                                 "percent": 100 if name == "openai" else 0}
                          for name in ("openai", "anthropic", "xai", "zcode", "deepseek", "gemini", "qwen")},
            "topModels": [{"model": "gpt-ui-00", "tokens": 1000}],
            "lastActive": today.isoformat() if i == 0 else timeline[i % 45]["date"],
            "daily": [{"date": today.isoformat(), "totalTokens": (i + 1) * 100, "totalCost": (i + 1) / 10}],
            "todayTokens": (i + 1) * 100, "todayCost": (i + 1) / 10,
        })
    images = [{"id": f"ui-image-{i:02d}", "filePath": f"F:\\fixture\\image-{i:02d}.png",
               "fileSize": "1 KB", "date": today.isoformat(),
               "timestamp": f"{today}T08:00:00Z", "prompt": f"Fixture artwork {i:02d}"}
              for i in range(65)]
    totals = {"totalCount": 65, "totalCost": 2.6, "totalTokens": 1_300_000,
              "formattedCost": "$2.60", "formattedTokens": "1.3M", "activeDays": 1,
              "todayDate": today.isoformat(), "todayCount": 65, "todayCost": 2.6,
              "todayTokens": 1_300_000}
    return {
        "meta": {"today": today.isoformat(), "generatedAt": f"{today}T08:00:00Z",
                 "serverTime": f"{today}T08:00:00Z", "agentFilter": "all", "pricingTier": "standard",
                 "totalDays": 45, "earliestMilestone": timeline[0]["date"],
                 "costNotice": "API equivalent fixture", "sourceSelectionMode": "complete",
                 "pricing": {"mode": "recorded", "currentVersion": "catalog-" + "b" * 24, "versions": [
                     {"id": "catalog-" + "a" * 24, "capturedAt": "2026-10-01T08:00:00Z"},
                     {"id": "catalog-" + "b" * 24, "capturedAt": "2026-10-18T08:00:00Z"}]}},
        "totals": {"totalCostUSD": 2475, "totalTokens": 247_500_000,
                   "cacheReadTokens": 123_750_000, "cacheRate": 50, "thisMonthCost": 715,
                   "formattedCost": "$2,475.00", "formattedTokens": "247.5M", "formattedCacheTokens": "123.8M"},
        "companies": [{"name": "OpenAI", "label": "OpenAI", "color": "#3b82f6",
                       "totalCost": 2475, "totalTokens": 247_500_000, "cacheTokens": 123_750_000,
                       "activeDays": 45, "status": "active", "formattedCost": "$2,475.00",
                       "formattedTokens": "247.5M"}],
        "models": [{"modelName": name, "agent": "codex", "company": "OpenAI",
                    "totalCost": cost * 45, "totalTokens": tokens * 45, "cacheTokens": tokens * 22,
                    "formattedCost": f"${cost * 45:.2f}", "formattedTokens": str(tokens * 45)}
                   for name, cost, tokens in model_specs],
        "modelFamilies": [], "agentBreakdown": {}, "timeline": timeline, "projects": projects,
        "imageAnalysis": {"model": "GPT-Image-2", "totals": totals,
                          "daily": [{"date": today.isoformat(), "count": 65, "cost": 2.6,
                                     "tokens": 1_300_000, "images": images}], "recentImages": images},
        "todaySummary": {**copy.deepcopy(timeline[-1]), "thisMonthCost": 715,
                         "images": {"count": 65, "cost": 2.6, "tokens": 1_300_000}},
        "codexQuota": {"schemaVersion": 2, "timezone": "Asia/Shanghai", "latest": None,
                       "daily": [], "windows": [], "completedWindows": []},
        "zcodePricingInfo": {"currentTier": "standard", "standardCostTotal": 0, "flagshipCostTotal": 0},
    }


class ApiStub:
    def __init__(self):
        self.fixture = make_fixture()
        self.fail_dashboard = False
        self.delay = 0
        self.race = False
        self.bad_image = False
        self.dashboard_requests = 0
        self.catalog_images = copy.deepcopy(self.fixture['imageAnalysis']['recentImages'])
        self.fail_catalog = False
        self.catalog_delay = 0
        self.live_requests = 0
        self.fail_live = False
        self.refresh_report = {"success": True}
        self.fail_sources = False
        self.last_dashboard_query = {}
        self.exports = []
        self.usage_queries = []
        self.live_fixture = {
            "agent": "codex", "generatedAt": 1791878400000, "sourceAvailable": True,
            "status": "active", "readErrors": 0, "activeSessionCount": 1,
            "totals": {"tokensPerSecond": 110, "inputTokensPerSecond": 10,
                       "cacheReadTokensPerSecond": 90, "outputTokensPerSecond": 10, "requests": 2},
            "sessions": [{"sessionId": "fixture-chat", "cwd": "F:/工程/<img src=x onerror=alert(1)>",
                          "model": "gpt-6.1-sol", "lastUsageAt": 1791878400000, "active": True,
                          "tokensPerSecond": 110, "inputTokensPerSecond": 10,
                          "cacheReadTokensPerSecond": 90, "outputTokensPerSecond": 10}]
        }
        self.live_fixture['imageActivity'] = {
            "sourceAvailable": True, "readErrors": 0, "scannedAt": 1791878400000,
            "latestImageAt": 1791878399000, "filesLastMinute": 1, "filesLastFiveMinutes": 3,
            "tokenUsageAvailable": False, "tokensPerSecond": None,
        }

    async def handle(self, route):
        parsed = urlparse(route.request.url)
        if parsed.path == "/api/dashboard":
            self.dashboard_requests += 1
            query = parse_qs(parsed.query)
            self.last_dashboard_query = query
            agent = query.get("agent", ["all"])[0]
            delay = 0.65 if self.race and agent == "codex" else self.delay
            await asyncio.sleep(delay)
            payload = copy.deepcopy(self.fixture)
            payload["meta"]["agentFilter"] = agent
            payload["meta"]["pricingTier"] = query.get("tier", ["standard"])[0]
            payload["meta"]["actualOnly"] = query.get("actualOnly", ["false"])[0] == "true"
            payload["meta"]["pricing"]["mode"] = query.get("pricingMode", ["recorded"])[0]
            if payload["meta"]["actualOnly"]:
                for day in payload["timeline"]:
                    day["estimatedTokens"] = 0
            try:
                await route.fulfill(status=503 if self.fail_dashboard else 200,
                                    json={"error": "fixture failure"} if self.fail_dashboard else payload)
            except Exception as error:
                # AbortController may cancel the slower response in the race check.
                if "closed" not in str(error).lower() and "invalid interception" not in str(error).lower():
                    raise
        elif parsed.path == "/api/sources":
            await route.fulfill(status=503 if self.fail_sources else 200, json={
                "meta": {"stale": False}, "capabilities": {"node": "24.fixture", "sqlite": False, "zstandard": True},
                "sources": {"qwen": {"source": "qwen", "available": True, "status": "ready", "stale": False,
                    "paths": ["F:/logs/<img src=x onerror=alert(1)>"], "lastSuccessfulAt": "2026-10-18T08:00:00Z",
                    "parseErrors": 2, "readErrors": 1, "coverage": {"from": "2026-10-01", "to": "2026-10-18"}}}})
        elif parsed.path == "/api/usage-records":
            query = parse_qs(parsed.query)
            self.usage_queries.append(query)
            offset = int(query.get('offset', ['0'])[0])
            limit = int(query.get('limit', ['50'])[0])
            rows = [{"id": str(i), "date": date.today().isoformat(), "timestamp": f"{date.today()}T08:00:00Z",
                     "source": "codex", "model": "gpt-fixture", "sessionId": f"chat-{i}", "granularity": "request",
                     "totalTokens": 120, "estimated": False, "costUSD": None if i == 64 else 0.5, "costComplete": i != 64}
                    for i in range(65)]
            await route.fulfill(json={"totalCount": len(rows), "records": rows[offset:offset+limit],
                "totals": {"totalTokens": 7800, "totalCostUSD": 32, "costComplete": False}})
        elif parsed.path == "/api/export":
            query = parse_qs(parsed.query)
            self.exports.append(query)
            if query.get('format', ['json'])[0] == 'csv':
                await route.fulfill(content_type='text/csv', body='metadata,fixture\r\nid,totalTokens\r\nfixture,120\r\n')
            else:
                await route.fulfill(json={"metadata": {"filters": query, "timezone": "Asia/Shanghai"}, "records": []})
        elif parsed.path == "/api/codex-live":
            self.live_requests += 1
            await route.fulfill(status=503 if self.fail_live else 200,
                                json={"error": "fixture failure"} if self.fail_live else self.live_fixture)
        elif parsed.path == "/api/codex-images":
            await asyncio.sleep(self.catalog_delay)
            await route.fulfill(status=503 if self.fail_catalog else 200, json={"images": self.catalog_images, "totalCount": len(self.catalog_images)})
        elif parsed.path == "/api/codex-image":
            await route.fulfill(status=404 if self.bad_image else 200,
                                content_type="image/png", body=b"" if self.bad_image else PNG)
        elif parsed.path == "/api/models-pricing":
            await route.fulfill(json={"models": {"gpt-ui-00": {"label": "Fixture model", "company": "OpenAI",
                                  "agent": "codex", "standard": {"in": 1, "out": 2, "cache": 0.1},
                                  "pricingEvidence": {"status": "verified", "checkedAt": "2026-11-19",
                                      "source": "https://developers.openai.com/api/docs/pricing"}},
                                  "legacy-ui": {"label": "Legacy reference", "standard": {"in": 1},
                                      "pricingEvidence": {"status": "legacy-reference", "source": "javascript:alert(1)"}},
                                  "provider-ui": {"label": "Unspecified provider", "unpriced": True,
                                      "pricingEvidence": {"status": "provider-required"}},
                                  "qwen-ui": {"label": "Partial Qwen reference", "standard": {"in": 1.678, "out": 5.035, "cache": None},
                                      "pricingEvidence": {"status": "verified", "region": "cn-beijing",
                                          "originalCurrency": "CNY", "exchangeRateCNYPerUSD": 7.15}},
                                  "expired-ui": {"label": "Expired reference", "standard": {"in": 99},
                                      "pricingPolicy": {"validThrough": "2000-01-01"}}},
                                      "companies": {"OpenAI": {"color": "#3b82f6", "badgeClass": "badge-codex"}}})
        elif parsed.path == "/api/refresh":
            await route.fulfill(status=207 if self.refresh_report.get('partial') else 200, json=self.refresh_report)
        else:
            await route.continue_()


async def ready(page, base_url):
    await page.goto(base_url, wait_until="domcontentloaded")
    await page.wait_for_function("typeof Chart !== 'undefined' && !!Chart.getChart('mainChart')")
    await expect(page.locator("#stat-total-cost")).not_to_have_text("--")


async def open_view(page, name):
    await page.locator(f"#btn-view-{name}").click()
    await expect(page.locator(f"#view-{name}")).to_be_visible()


async def check_layout(page, stub):
    for width in (320, 390, 768, 1440):
        await page.set_viewport_size({"width": width, "height": 1000})
        for theme in ("light", "dark"):
            await page.evaluate("mode => setThemeMode(mode)", theme)
            for view in VIEWS:
                await open_view(page, view)
                dimensions = await page.evaluate("({width: innerWidth, scroll: document.documentElement.scrollWidth})")
                assert dimensions["scroll"] <= dimensions["width"] + 1, f"{width}px {theme} {view}: {dimensions}"


async def check_navigation(page, stub):
    timeline = page.locator("#btn-view-timeline")
    await expect(timeline).to_have_attribute("role", "tab")
    await expect(timeline).to_have_attribute("aria-controls", "view-timeline")
    await timeline.focus()
    await page.keyboard.press("ArrowRight")
    await expect(page.locator("#btn-view-projects")).to_be_focused()
    await expect(page.locator("#btn-view-projects")).to_have_attribute("aria-selected", "true")
    await page.keyboard.press("End")
    await expect(page.locator("#btn-view-gallery")).to_be_focused()
    await page.keyboard.press("Home")
    await expect(page.locator("#btn-view-today")).to_be_focused()
    for name in VIEWS:
        await expect(page.locator(f"#view-{name}")).to_have_attribute("role", "tabpanel")


async def check_chart(page, stub):
    await page.evaluate("window.__chartBefore = Chart.getChart('mainChart')")
    await page.locator("#chart-legend .legend-badge").first.click()
    assert await page.evaluate("!Chart.getChart('mainChart').isDatasetVisible(0)"), "Legend did not hide dataset"
    await page.locator("#axis-tokens").click()
    await page.evaluate("setThemeMode('light')")
    await page.locator("#btn-date-7d").click()
    assert await page.evaluate("Chart.getChart('mainChart') === window.__chartBefore"), "Chart instance replaced"
    assert await page.evaluate("!Chart.getChart('mainChart').isDatasetVisible(0)"), "Hidden series lost during update"
    await page.locator("#dim-model").click()
    names = await page.evaluate("Chart.getChart('mainChart').data.datasets.map(d => d.label)")
    assert names == [f"gpt-ui-{i:02d}" for i in range(8)], f"Token top eight are incorrect: {names}"
    await page.locator("#axis-cost").click()
    names = await page.evaluate("Chart.getChart('mainChart').data.datasets.map(d => d.label)")
    assert names == [f"gpt-ui-{i:02d}" for i in range(9, 1, -1)], f"Cost top eight are incorrect: {names}"
    await page.locator(".chart-settings summary").click()
    await page.locator("#chart-series-limit").select_option("all")
    assert await page.evaluate("Chart.getChart('mainChart').data.datasets.length") == 10, "All series omitted active models or added unused models"
    assert await page.evaluate("Chart.getChart('mainChart') === window.__chartBefore"), "Dimension or series limit replaced chart"


async def check_dates(page, stub):
    await page.locator('#date-range-popover > summary').click()
    await page.locator("#input-start-date").fill("2026-10-13")
    await page.locator("#input-start-date").dispatch_event("change")
    previous = await page.evaluate("Chart.getChart('mainChart').data.labels.slice()")
    await page.locator("#input-end-date").fill("2026-09-01")
    await page.locator("#input-end-date").dispatch_event("change")
    invalid = await page.evaluate("['input-start-date','input-end-date'].some(id => !document.getElementById(id).checkValidity() || document.getElementById(id).getAttribute('aria-invalid') === 'true')")
    assert invalid, "Reversed date range needs an accessible validation state"
    assert previous == await page.evaluate("Chart.getChart('mainChart').data.labels"), "Invalid dates changed displayed data"
    await page.locator("#btn-date-all").click()
    assert await page.evaluate("document.getElementById('input-end-date').checkValidity()"), "Preset did not clear validation"


async def check_requests(page, stub):
    old = await page.evaluate("appState.cachedData.timeline.length")
    old_cost = await page.locator("#stat-total-cost").inner_text()
    stub.delay = 0.4
    await page.evaluate("void refreshData()")
    await expect(page.locator("#btn-refresh")).to_have_class(re.compile("loading"))
    assert await page.evaluate("appState.cachedData.timeline.length") == old, "Refresh cleared old data"
    await expect(page.locator("#stat-total-cost")).to_have_text(old_cost)
    await expect(page.locator("#btn-refresh")).not_to_have_class(re.compile("loading"))
    stub.fail_dashboard = True
    await page.evaluate("void loadDashboard()")
    await expect(page.locator("#global-error-banner")).to_be_visible()
    assert await page.evaluate("appState.cachedData.timeline.length") == old, "Error cleared old data"
    await expect(page.locator("#stat-total-cost")).to_have_text(old_cost)
    assert "上次" in await page.locator("#global-error-banner").inner_text(), "Error must explain retained data"
    stub.fail_dashboard, stub.delay, stub.race = False, 0, True
    await page.evaluate("setAgentFilter('codex'); setAgentFilter('claude')")
    await page.wait_for_function("appState.cachedData.meta.agentFilter === 'claude'")
    await page.wait_for_timeout(800)
    assert await page.evaluate("appState.cachedData.meta.agentFilter") == "claude", "Stale request overwrote newer selection"
    await expect(page.locator("#global-error-banner")).not_to_be_visible()


async def check_pagination(page, stub):
    cases = (
        ("timeline", "#table-body tr", "#table-pagination", "#table-search-input", 45, 30),
        ("projects", "#projects-grid .project-card", "#projects-pagination", "#project-search-input", 37, 24),
        ("gallery", "#studio-grid .studio-card", "#gallery-pagination", "#gallery-search-input", 65, 30),
    )
    for view, items, pager, search, total, maximum in cases:
        await open_view(page, view)
        await expect(page.locator(items).first).to_be_visible()
        count = await page.locator(items).count()
        assert 0 < count <= maximum and count < total, f"{view}: {count} items rendered without pagination"
        before = await page.locator(items).first.inner_text()
        await page.locator(f"{pager} button").last.click()
        after = await page.locator(items).first.inner_text()
        assert before != after, f"{view}: next page did not change items"
        await page.locator(search).fill("no-such-ui-fixture-abcdef")
        container = "#table-body" if view == "timeline" else "#projects-grid" if view == "projects" else "#studio-grid"
        clear = page.locator(f"{container} button").filter(has_text=re.compile("清除|重置"))
        await expect(clear).to_be_visible()
        await clear.click()
        await expect(page.locator(search)).to_have_value("")
        assert await page.locator(items).count() > 0, f"{view}: clearing empty-state filter did not restore items"
        if view == "projects":
            expand = page.locator(".project-expand-btn").first
            await expand.click()
            await expect(expand).to_have_attribute("aria-expanded", "true")
            controlled = await expand.get_attribute("aria-controls")
            assert controlled, "Project expand button needs aria-controls"
            await expect(page.locator(f"#{controlled}")).to_be_visible()


async def assert_focus_inside(page, overlay):
    assert await page.evaluate("id => document.getElementById(id).contains(document.activeElement)", overlay), f"Focus escaped {overlay}"


async def check_modals(page, stub):
    for view, trigger_id, modal_id in (("timeline", "btn-pricing-matrix", "pricing-modal"),
                                       ("today", "btn-sub-config", "sub-config-modal")):
        await open_view(page, view)
        if trigger_id == "btn-pricing-matrix":
            await page.locator("#dashboard-settings summary").click()
        trigger = page.locator(f"#{trigger_id}")
        await trigger.focus()
        await trigger.click()
        await expect(page.locator(f"#{modal_id}")).to_be_visible()
        if modal_id == "pricing-modal":
            verified = page.locator('.pricing-row[data-key="gpt-ui-00"]')
            await expect(verified).to_contain_text("已核对 · 2026-11-19")
            await expect(verified.locator('a')).to_have_attribute('href', 'https://developers.openai.com/api/docs/pricing')
            await expect(page.locator('.pricing-row[data-key="legacy-ui"]')).to_contain_text('待复核')
            await expect(page.locator('.pricing-row[data-key="legacy-ui"] a')).to_have_count(0)
            await expect(page.locator('.pricing-row[data-key="provider-ui"]')).to_contain_text('需指定提供商')
            await expect(page.locator('.pricing-row[data-key="provider-ui"] td').nth(2)).to_have_text('暂无费率')
            await expect(page.locator('.pricing-row[data-key="qwen-ui"]')).to_contain_text('cn-beijing · CNY ÷ 7.15')
            await expect(page.locator('.pricing-row[data-key="qwen-ui"] td').nth(2)).to_have_text('$1.68')
            await expect(page.locator('.pricing-row[data-key="qwen-ui"] td').nth(4)).to_have_text('暂无费率')
            await expect(page.locator('.pricing-row[data-key="expired-ui"]')).to_contain_text('参考价已过期')
            await expect(page.locator('.pricing-row[data-key="expired-ui"] td').nth(2)).to_have_text('暂无费率')
        await assert_focus_inside(page, modal_id)
        for _ in range(12):
            await page.keyboard.press("Tab")
            await assert_focus_inside(page, modal_id)
        await page.keyboard.press("Escape")
        await expect(page.locator(f"#{modal_id}")).not_to_be_visible()
        await expect(trigger).to_be_focused()


async def check_lightbox(page, stub):
    await open_view(page, "gallery")
    trigger = page.locator("#studio-grid .studio-card").first
    await trigger.focus()
    await trigger.press("Enter")
    dialog = page.locator("#image-lightbox")
    await expect(dialog).to_be_visible()
    await assert_focus_inside(page, "image-lightbox")
    await page.wait_for_function("document.getElementById('lightbox-image').naturalWidth > 0")
    first_src = await page.locator("#lightbox-image").get_attribute("src")
    await page.locator("#lightbox-next").click()
    await expect(page.locator("#lightbox-image")).not_to_have_attribute("src", first_src)
    await page.keyboard.press("ArrowLeft")
    await expect(page.locator("#lightbox-image")).to_have_attribute("src", first_src)
    original_zoom = await page.locator("#lightbox-image").evaluate("e => e.style.transform")
    await page.locator("#lightbox-zoom-in").click()
    assert original_zoom != await page.locator("#lightbox-image").evaluate("e => e.style.transform"), "Zoom did not change image transform"
    await page.locator("#lightbox-zoom-reset").click()
    assert await page.locator("#lightbox-image").evaluate("e => e.style.transform") == original_zoom, "Reset did not restore zoom"
    stub.bad_image = True
    await page.locator("#lightbox-next").click()
    await expect(page.locator("#lightbox-error")).to_be_visible()
    stub.bad_image = False
    await page.locator("#lightbox-retry").click()
    await expect(page.locator("#lightbox-error")).not_to_be_visible()
    await page.wait_for_function("document.getElementById('lightbox-image').naturalWidth > 0")
    await page.keyboard.press("Escape")
    await expect(dialog).not_to_be_visible()
    await expect(trigger).to_be_focused()


async def check_reduced_motion(page, stub):
    await page.emulate_media(reduced_motion="reduce")
    await page.locator("#axis-tokens").click()
    animation = await page.evaluate("Chart.getChart('mainChart').options.animation")
    assert animation is False or isinstance(animation, dict) and animation.get("duration") == 0, "Chart ignores reduced motion"
    animations = await page.evaluate("document.getAnimations().filter(a => a.playState === 'running').map(a => ({target: a.effect.target.id || a.effect.target.className, duration:a.effect.getTiming().duration, iterations:a.effect.getTiming().iterations}))")
    assert not any(a["duration"] > 20 for a in animations if isinstance(a["duration"], (int, float))), f"Long animations under reduced motion: {animations}"


async def check_refinements(page, stub):
    await page.evaluate("setDatePreset('7d')")
    assert await page.evaluate("getFilteredTimeline().length") == 7, "7-day range must include exactly 7 dates"
    await page.evaluate("setDatePreset('30d')")
    assert await page.evaluate("getFilteredTimeline().length") == 30, "30-day range must include exactly 30 dates"
    await page.locator('.chart-settings > summary').click()
    await page.evaluate("document.getElementById('input-custom-y').value='-1'; applyCustomYMax()")
    await expect(page.locator("#custom-y-error")).to_be_visible()
    await page.evaluate("resetZoomAndScale()")
    assert await page.locator("#input-custom-y").evaluate("e => e.checkValidity()")
    await page.evaluate("lastSuccessfulFetch=Date.now()-360000; setDataStatus('fresh'); markDataStale()")
    await expect(page.locator("body")).to_have_attribute("data-data-state", "stale")
    await page.evaluate("loadDashboard()")
    await expect(page.locator("body")).to_have_attribute("data-data-state", "fresh")

    stub.fixture["timeline"][0]["totalCost"] = 9999
    stub.fixture["timeline"][0]["totalTokens"] = 999999999
    await page.evaluate("loadDashboard()")
    await page.evaluate("setDatePreset('all')")
    for metric in ("cost", "tokens"):
        await page.locator("#table-sort").select_option(metric)
        await expect(page.locator("#table-body tr").first.locator("td").first).to_have_text(stub.fixture["timeline"][0]["date"])

    await page.evaluate("setDatePreset('today')")
    await expect(page.locator("#model-rank-list")).to_contain_text("GPT-Image-2")
    await page.evaluate("document.getElementById('input-start-date').value='2026-09-01'; document.getElementById('input-end-date').value='2026-09-10'; applyCustomDateRange()")
    await expect(page.locator("#model-rank-list")).not_to_contain_text("GPT-Image-2")

    await open_view(page, "gallery")
    first = page.locator("#studio-grid .studio-card").first
    await first.evaluate("e => window.__retainedCard = e")
    await page.locator("#gallery-search-input").fill("Fixture artwork 00")
    await expect(page.locator("#studio-grid .studio-card")).to_have_count(1)
    assert await page.evaluate("document.querySelector('#studio-grid .studio-card') === window.__retainedCard"), "Filtering should reuse loaded thumbnail nodes"
    stub.bad_image = True
    await first.locator("img").evaluate("e => e.src += '&fixture-failure=1'")
    await expect(first.locator(".thumbnail-error-box")).to_be_visible()
    stub.bad_image = False
    await first.locator(".thumbnail-retry").click()
    await expect(first.locator(".thumbnail-error-box")).to_have_count(0)
    await expect(page.locator("#image-lightbox")).not_to_be_visible()
    await page.wait_for_function("!document.querySelector('#studio-grid .studio-img-wrap').classList.contains('is-image-loading')")


async def check_full_catalog(page, stub):
    stub.fixture['imageAnalysis']['recentImages'] = stub.catalog_images[:2]
    stub.catalog_delay = .4
    stub.catalog_images[-1]['date'] = '2026-09-01'
    await page.evaluate('loadDashboard()')
    await open_view(page, 'gallery')
    await expect(page.locator('#gallery-catalog-status')).to_be_visible()
    await expect(page.locator('#studio-grid .studio-card')).to_have_count(24)
    await expect(page.locator('#gallery-catalog-status')).not_to_be_visible()
    await expect(page.locator('#gallery-pagination')).to_contain_text('65')
    await page.locator('#gallery-search-input').fill('Fixture artwork 64')
    await expect(page.locator('#studio-grid .studio-card')).to_have_count(1)
    await expect(page.locator('#studio-grid')).to_contain_text('Fixture artwork 64')
    await page.locator('#gallery-search-input').fill('')
    await page.evaluate("setGalleryDate('2026-09-01')")
    await expect(page.locator('#studio-grid .studio-card')).to_have_count(1)
    await expect(page.locator('#studio-grid')).to_contain_text('2026-09-01')
    stub.fail_catalog = True
    await page.evaluate('loadDashboard()')
    await expect(page.locator('#gallery-catalog-status')).to_contain_text('读取失败')
    stub.fail_catalog = False
    await page.get_by_role('button', name='重试完整索引').click()
    await expect(page.locator('#gallery-catalog-status')).not_to_be_visible()
    await expect(page.locator('#studio-grid .studio-card')).to_have_count(1)


async def check_data_presentation(page, stub):
    stub.fixture['companies'].extend([
        {'name': 'Anthropic', 'label': 'Anthropic', 'color': '#d97706'},
        {'name': 'xAI', 'label': 'Grok', 'color': '#8b5cf6'},
    ])
    for day in stub.fixture['timeline']:
        day['byCompany']['Anthropic'] = {'cost': 5, 'tokens': 10_000_000}
        day['byModel']['claude-fixture'] = {'company': 'Anthropic', 'agent': 'claude', 'cost': 5, 'tokens': 10_000_000}
        day['totalCost'] += 5
        day['totalTokens'] += 10_000_000
    await page.evaluate('loadDashboard()')
    await expect(page.locator('#company-count')).to_have_text('2 个活跃厂商')
    await expect(page.locator('#company-grid .source-row')).to_have_count(2)
    await expect(page.locator('#company-grid .source-name').first).to_have_text('OpenAI')
    await expect(page.locator('#inactive-sources-label')).to_contain_text('1')
    await expect(page.locator('#inactive-source-list')).not_to_be_visible()
    await page.locator('#inactive-sources-label').click()
    await expect(page.locator('#inactive-source-list')).to_contain_text('Grok')
    await page.locator('#axis-tokens').click()
    await expect(page.locator('#company-grid .source-name').first).to_have_text('Anthropic')
    assert await page.locator('.metric-sparkline svg').count() == 4
    card_bounds = await page.locator('.family-card').evaluate_all('(cards)=>cards.map(card=>({height:card.getBoundingClientRect().height,header:card.querySelector(".family-header").getBoundingClientRect().height}))')
    assert all(row['height'] >= row['header'] for row in card_bounds), f'Model family headers clipped: {card_bounds}'
    await expect(page.locator('#stat-cache-rate')).to_contain_text('读取占比')
    assert await page.evaluate("formatUSD(.00001)") == '<$0.01'
    assert await page.evaluate("formatUSD(null)") == '—'
    await open_view(page, 'projects')
    await expect(page.locator('#proj-stat-focus')).to_have_text('UI project 36')
    await page.locator('#project-search-input').fill('UI project 00')
    await expect(page.locator('#proj-stat-focus')).to_have_text('UI project 00')
    await expect(page.locator('#proj-focus-hint')).to_contain_text('100.0%')
    for day in stub.fixture['timeline']:
        day['totalCost'] = 0
        for company in day['byCompany'].values():
            company['cost'] = 0
        for model in day['byModel'].values():
            model['cost'] = 0
            model['unpriced'] = True
    for day in stub.fixture['imageAnalysis']['daily']:
        day['cost'] = 0
        day['tokens'] = 0
    await open_view(page, 'timeline')
    await page.evaluate("setAxisMode('cost'); loadDashboard()")
    await expect(page.locator('#stat-total-cost')).to_have_text('—')
    await expect(page.locator('#chart-empty-state')).to_contain_text('有 Token 记录')
    await expect(page.locator('#table-body tr').first.locator('td').last).to_have_text('未定价')
    await expect(page.locator('#model-rank-list')).to_contain_text('暂无费率')
    await page.get_by_role('button', name='查看 Token 走势').click()
    assert await page.evaluate('appState.chartInstance.data.datasets.length') == 2


async def check_calendar_context(page, stub):
    first = copy.deepcopy(stub.fixture['timeline'][0])
    last = copy.deepcopy(first)
    first['date'], last['date'] = '2026-12-31', '2027-01-02'
    stub.fixture['timeline'] = [first, last]
    stub.fixture['meta']['today'] = '2027-01-02'
    stub.fixture['meta']['earliestMilestone'] = '2026-12-31'
    await page.evaluate('loadDashboard();')
    await page.evaluate("setDatePreset('all')")
    chart = await page.evaluate("""() => {
        appState.chartInstance.update('none');
        return {labels:appState.chartInstance.data.labels, values:appState.chartInstance.data.datasets[0].data,
            segments:appState.chartInstance.getDatasetMeta(0).dataset.segments.map(({start,end}) => ({start,end}))};
    }""")
    assert chart['labels'] == ['2026/12/31', '2027/01/01', '2027/01/02'], chart
    assert chart['values'] == [55, None, 55], chart
    assert chart['segments'] == [{'start': 0, 'end': 2}], chart
    for sparkline in await page.locator('.metric-sparkline path').all():
        path = await sparkline.get_attribute('d')
        assert path.count('M') == 1 and path.count('L') == 1, path
    await expect(page.locator('#chart-context')).to_contain_text('1 天无记录')
    await page.locator('#chart-legend .legend-badge').first.click()
    await expect(page.locator('#chart-context')).to_contain_text('显示 0/1')
    await page.locator('#chart-legend .legend-badge').first.click()
    await page.locator('.chart-settings summary').click()
    await page.locator('#btn-scale-micro').click()
    await expect(page.locator('#chart-range-warning')).to_contain_text('2 个数据点超出')
    await page.get_by_role('button', name='恢复完整刻度').click()
    await expect(page.locator('#chart-range-warning')).not_to_be_visible()
    await page.locator('#dim-model').click()
    await expect(page.locator('#chart-context')).to_contain_text('8/10 个活跃模型')
    # Verify actual rendered segments across both metrics, dimensions and scale modes.
    for dimension in ('company', 'model'):
        for metric in ('cost', 'tokens'):
            for logarithmic in (False, True):
                lines = await page.evaluate("""({dimension,metric,logarithmic}) => {
                    setChartDimension(dimension);
                    setAxisMode(metric);
                    if (appState.isLogScale !== logarithmic) toggleLogScale();
                    appState.chartInstance.update('none');
                    return appState.chartInstance.data.datasets.map((dataset,index) => ({
                        values:dataset.data,
                        segments:appState.chartInstance.getDatasetMeta(index).dataset.segments.map(({start,end}) => ({start,end}))
                    }));
                }""", {'dimension': dimension, 'metric': metric, 'logarithmic': logarithmic})
                assert lines, (dimension, metric, logarithmic)
                for line in lines:
                    assert line['values'][1] is None, line
                    assert line['values'][0] == line['values'][2] > 0, line
                    assert line['segments'] == [{'start': 0, 'end': 2}], line


async def check_gallery_presentation(page, stub):
    stub.fixture['imageAnalysis']['recentImages'][0]['prompt'] = 'Codex 自动化生图工具任务'
    await page.evaluate('loadDashboard()')
    await open_view(page, 'gallery')
    first = page.locator('#studio-grid .studio-card').first
    image = first.locator('img')
    await expect(first.locator('.studio-dimensions')).to_have_text('1 × 1')
    await expect(first.locator('.studio-prompt-text')).to_have_text('image-00.png')
    assert await image.evaluate("e => getComputedStyle(e).objectFit") == 'contain'
    await image.evaluate('e => window.__retainedImage = e')
    await page.locator('#gallery-fit-cover').click()
    assert await image.evaluate("e => getComputedStyle(e).objectFit") == 'cover'
    assert await image.evaluate('e => e === window.__retainedImage')
    await open_view(page, 'today')
    await open_view(page, 'gallery')
    await expect(page.locator('#gallery-fit-cover')).to_have_attribute('aria-pressed', 'true')
    await page.locator('#gallery-fit-contain').click()
    await expect(page.locator('#gallery-cost-hint')).to_contain_text('每张参考')
    assert '官方 3~5' not in await page.locator('#view-gallery').inner_text()
    for width in (320, 390, 768):
        await page.set_viewport_size({'width': width, 'height': 900})
        await page.wait_for_timeout(60)
        bounds = await first.locator('.studio-meta-row').evaluate('(e) => { const p=e.getBoundingClientRect(); return [...e.children].filter(c=>c.getClientRects().length).every(c=>{const r=c.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1}); }')
        assert bounds, f'Image metadata clipped at {width}px'


async def check_today_project_context(page, stub):
    for project in stub.fixture['projects'][:8]:
        project['lastActive'] = stub.fixture['meta']['today']
    original_path = '\\\\?\\F:\\fixture\\parent-folder\\nested-directory\\project-00'
    stub.fixture['projects'][0]['primaryPath'] = original_path
    await page.evaluate('loadDashboard()')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-tokens')).to_have_text('5.5M')
    await expect(page.locator('#today-stat-images-sub')).to_contain_text('Token 等值')
    await expect(page.locator('#today-workspaces-section .today-workspace-card')).to_have_count(5)
    await expect(page.locator('.today-more-models')).to_have_count(1)
    await expect(page.locator('#today-models-list > .today-model-item')).to_have_count(6)
    await page.locator('.today-more-models summary').click()
    await expect(page.locator('.today-more-models .today-model-item')).to_have_count(5)
    await expect(page.locator('#today-active-badge')).to_contain_text('8 个')
    await page.locator('.today-workspaces-more').click()
    await expect(page.locator('#view-projects')).to_be_visible()
    await expect(page.locator('#project-today-only')).to_have_attribute('aria-pressed', 'true')
    await expect(page.locator('#projects-grid .project-card')).to_have_count(8)
    first = page.locator('#projects-grid .project-card').first
    await expect(first.locator('.project-path-pill')).to_contain_text('F:/…/nested-directory/project-00')
    assert '\\\\?\\' not in await first.locator('.project-path-pill').inner_text()
    await page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__requestedClipboard=value;}}})")
    await first.locator('.copy-path-btn').click()
    assert await page.evaluate('window.__requestedClipboard') == original_path
    await expect(first.locator('.copy-path-btn')).to_have_text('已复制')
    await page.locator('#project-today-only').click()
    await expect(page.locator('#projects-results-summary')).to_contain_text('37 / 37')


async def check_codex_live(page, stub):
    assert stub.live_requests == 0, "Timeline should not poll live usage"
    await open_view(page, 'today')
    assert stub.live_requests == 0, 'Today must not poll live usage'
    await expect(page.locator('#view-today .codex-live-panel')).to_have_count(0)
    await open_view(page, 'live')
    await expect(page.locator('#codex-live-toggle')).to_have_attribute('aria-checked', 'true')
    await expect(page.locator('#codex-live-interval')).to_have_value('2000')
    await expect(page.locator('#codex-live-total')).to_have_text('110')
    await expect(page.locator('#codex-live-input')).to_have_text('10')
    await expect(page.locator('#codex-live-cache')).to_have_text('90')
    await expect(page.locator('#codex-live-output')).to_have_text('10')
    await expect(page.locator('#codex-live-count')).to_contain_text('1 个会话')
    await expect(page.locator('#codex-live-sessions')).to_contain_text('<img src=x onerror=alert(1)>')
    await expect(page.locator('#codex-live-sessions img')).to_have_count(0)
    requests = stub.live_requests
    await asyncio.sleep(2.3)
    assert stub.live_requests > requests, 'Live view must refresh automatically'
    await open_view(page, 'timeline')
    requests = stub.live_requests
    await asyncio.sleep(1.2)
    assert stub.live_requests == requests, 'Leaving live must pause polling'
    stub.fail_live = True
    await open_view(page, 'live')
    await expect(page.locator('#codex-live-status')).to_contain_text('更新失败')
    await expect(page.locator('#codex-live-total')).to_have_text('110')
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('显示上次成功数据')
    stub.fail_live = False
    await expect(page.locator('#codex-live-total')).to_have_text('110')
    stub.live_fixture['sourceAvailable'] = False
    stub.live_fixture['status'] = 'unavailable'
    await page.locator('#codex-live-refresh').click()
    await expect(page.locator('#codex-live-status')).to_have_text('未找到会话日志')
    await expect(page.locator('#codex-live-total')).to_have_text('—')
    stub.live_fixture['sourceAvailable'] = True
    stub.live_fixture['status'] = 'idle'
    stub.live_fixture['activeSessionCount'] = 0
    stub.live_fixture['sessions'] = []
    for key in stub.live_fixture['totals']:
        stub.live_fixture['totals'][key] = 0
    await page.locator('#codex-live-refresh').click()
    await expect(page.locator('#codex-live-total')).to_have_text('0')
    await expect(page.locator('#codex-live-status')).to_have_text('最近 60 秒无对话用量')
    await expect(page.locator('#codex-live-sessions')).to_contain_text('最近 5 分钟没有对话用量记录')
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('每 5 秒检查')


async def check_codex_live_controls(page, stub):
    await open_view(page, 'live')
    await expect(page.locator('#codex-live-total')).to_have_text('110')


    await page.locator('#codex-live-toggle').click()
    await expect(page.locator('#codex-live-toggle')).to_have_attribute('aria-checked', 'false')
    requests = stub.live_requests
    await asyncio.sleep(2.2)
    assert stub.live_requests == requests, 'Manual pause must stop automatic requests'
    await page.locator('#codex-live-refresh').click()
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('已关闭')
    assert stub.live_requests == requests + 1, 'Manual refresh must issue one request'
    await asyncio.sleep(2.2)
    assert stub.live_requests == requests + 1, 'Manual refresh must leave auto disabled'
    await page.locator('#codex-live-interval').select_option('5000')
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'live')
    await expect(page.locator('#codex-live-toggle')).to_have_attribute('aria-checked', 'false')
    await expect(page.locator('#codex-live-interval')).to_have_value('5000')
    assert stub.live_requests == requests + 1, 'Reload must preserve disabled automatic updating'
    await page.locator('#codex-live-toggle').click()
    await expect(page.locator('#codex-live-total')).to_have_text('110')
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('每 5 秒')
    await page.locator('#codex-live-interval').select_option('1000')
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('每 1 秒')
    await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))")
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('浏览器在后台')
    requests = stub.live_requests
    await asyncio.sleep(1.2)
    assert stub.live_requests == requests, 'Hidden document must stop requests'
    await page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('每 1 秒')
    assert stub.live_requests > requests, 'Visible document must resume automatically'
    # Consecutive failures back off instead of continuously retrying at 1s.
    stub.fail_live = True
    await page.locator('#codex-live-refresh').click()
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('1 秒后重试')
    await expect(page.locator('#codex-live-refresh-state')).to_contain_text('2 秒后重试')
    stub.fail_live = False
    await expect(page.locator('#codex-live-total')).to_have_text('110')


async def check_codex_image_activity(page, stub):
    stub.live_fixture['activeSessionCount'] = 0
    stub.live_fixture['sessions'] = []
    for key in stub.live_fixture['totals']:
        stub.live_fixture['totals'][key] = 0
    await open_view(page, 'live')
    await expect(page.locator('#codex-live-total')).to_have_text('0')
    await expect(page.locator('#codex-live-image-count')).to_have_text('3')
    await expect(page.locator('#codex-live-image-status')).to_contain_text('图像 Token 未记录')
    await expect(page.locator('.codex-live-image-metrics > div').first.locator('strong')).to_have_text('—')
    stub.live_fixture['imageActivity']['filesLastFiveMinutes'] = 4
    await expect(page.locator('#codex-live-image-count')).to_have_text('4', timeout=8000)
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'live')
    await expect(page.locator('#codex-live-image-count')).to_have_text('4')
    await expect(page.locator('#codex-live-total')).to_have_text('0')

async def check_today_cost_scope(page, stub):
    # Reproduce the reported ~$66 headline versus ~$41 Codex daily total.
    today = stub.fixture['meta']['today']
    model = {'cost': 41.8, 'tokens': 1_000_000, 'cacheTokens': 800_000,
             'company': 'OpenAI', 'agent': 'codex'}
    summary = stub.fixture['todaySummary']
    summary.update(totalCost=41.8, byModel={'gpt-6.1-sol': model},
                   images={'count': 472, 'cost': 25.02, 'tokens': 9_440_000})
    stub.fixture['codexQuota']['daily'] = [{
        'date': today, 'apiEquivalentUSD': 41.8, 'usedPercent': 302,
        'quotaUnits': 3.02, 'quotaObserved': True, 'completedWindowCount': 0,
        'averagePer100USD': None, 'windows': [],
    }]
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-cost')).to_have_text('$41.80')
    await expect(page.locator('.today-metrics-grid .metric-card').first.locator('.card-title')).to_contain_text('今日请求 API 等值')
    await expect(page.locator('.today-metrics-grid .metric-card').first.locator('.card-tag')).to_have_text('日志折算')
    await expect(page.locator('#today-stat-cost-sub')).to_contain_text('图像工具费用未记录')
    await expect(page.locator('#today-stat-images-sub')).to_contain_text('文件参考 ≈$25.02 · 不计入合计')
    await expect(page.locator('#quota-day-cost')).to_have_text('≈$41.80')
    await expect(page.locator('#quota-day-cost-note')).to_contain_text('图像工具费用未记录')
    await expect(page.locator('#today-stat-roi-sub')).to_contain_text(
        '$41.80（请求日志折算）')
    await expect(page.locator('#today-stat-quota-sub')).to_contain_text('今日 $41.80')
    await expect(page.locator('#today-sub-scope-badge')).to_contain_text('按请求日志折算')
    await expect(page.locator('#today-proportional-bar .today-bar-seg')).to_have_count(1)
    await expect(page.locator('#today-proportional-bar .today-bar-seg')).to_have_attribute('style', re.compile('width: 100%'))
    await expect(page.locator('#today-models-list')).to_contain_text('文件数参考，不计入合计与占比')

    # Other sources belong in the headline, but not in Codex quota history.
    summary['totalCost'] = 51.8
    summary['byModel']['claude-fixture'] = {**model, 'cost': 10,
                                          'company': 'Anthropic', 'agent': 'claude'}
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-cost')).to_have_text('$51.80')
    await expect(page.locator('#today-stat-cost-sub')).to_contain_text('全部来源请求')
    await expect(page.locator('#quota-day-cost')).to_have_text('≈$41.80')
    await page.locator('#today-sub-plan-select').select_option('claude_pro')
    await expect(page.locator('#today-stat-roi-sub')).to_contain_text('$10.00（请求日志折算）')
    await expect(page.locator('#today-sub-scope-badge')).to_contain_text('按请求日志折算')
    await expect(page.locator('#today-stat-cost')).to_have_text('$51.80')

    # Images alone must not be presented as model API usage.
    summary.update(totalCost=0, byModel={})
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-cost')).to_have_text('$0.00')
    await expect(page.locator('#today-stat-cost-sub')).to_contain_text('图像工具费用未记录')
    await page.locator('#today-sub-plan-select').select_option('chatgpt_plus')
    await expect(page.locator('#today-stat-roi-sub')).to_contain_text(
        '$0.00（请求日志折算）')
    await expect(page.locator('#today-proportional-bar .today-bar-seg')).to_have_count(0)
    summary['images'] = {'count': 0, 'cost': 0, 'tokens': 0}
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-cost')).to_have_text('$0.00')
    await expect(page.locator('#today-stat-cost-sub')).to_have_text('全部来源请求 · 按日志折算')


async def check_complete_totals(page, stub):
    await open_view(page, 'timeline')
    await page.locator('#btn-date-all').click()
    await expect(page.locator('#stat-total-cost')).to_have_text('$2,475.00')
    await expect(page.locator('#stat-total-tokens')).to_have_text('247.5M')
    await expect(page.locator('#stat-total-tokens')).to_have_attribute('title', '247,500,000 Token')
    await expect(page.locator('#stat-tokens-sub')).to_contain_text('生图 Token 等值另列')
    await expect(page.locator('#stat-cache-rate')).to_contain_text('50%')
    await page.evaluate("appState.currentDatePreset='custom'; appState.startDate='2026-10-12'; appState.endDate='2026-10-12'; renderAll()")
    await expect(page.locator('#stat-total-cost')).to_have_text('$55.00')
    await expect(page.locator('#stat-total-tokens')).to_have_text('5.5M')
    await expect(page.locator('#stat-tokens-sub')).not_to_contain_text('生图')


async def check_quota_windows(page, stub):
    def timestamp(value):
        return int(datetime.fromisoformat(value).timestamp() * 1000)

    def window(start, end, reset, percent, cost):
        return {
            'startsAt': timestamp(start), 'displayEndsAt': timestamp(end),
            'resetsAt': timestamp(reset), 'usedPercent': percent, 'quotaObserved': True,
            'startCovered': True, 'apiEquivalentUSD': cost, 'estimatedPer100USD': 10,
            'estimateBasis': 'linear', 'comparisonUsedPercent': percent,
        }

    windows = [
        window('2026-10-12T23:00:00+08:00', '2026-10-13T01:00:00+08:00',
               '2026-10-13T04:00:00+08:00', 40, 4),
        window('2026-10-13T01:00:00+08:00', '2026-10-13T06:00:00+08:00',
               '2026-10-13T06:00:00+08:00', 100, 10),
    ]
    stub.fixture['codexQuota']['timelineVersion'] = 2
    stub.fixture['codexQuota']['daily'] = [{
        'date': '2026-10-13', 'usedPercent': 140, 'quotaUnits': 1.4,
        'apiEquivalentUSD': 14, 'averagePer100USD': 10, 'comparableUsedPercent': 140,
        'completedWindowCount': 1, 'windows': windows,
    }]
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    rows = page.locator('#quota-window-rows tr')
    await expect(rows).to_have_count(2)
    await expect(rows.nth(0).locator('td .font-mono').first).to_have_text('10/12 23:00–01:00')
    await expect(rows.nth(0).locator('td').first).to_contain_text('原定 04:00 重置')
    await expect(rows.nth(1).locator('td .font-mono').first).to_have_text('01:00–06:00')
    await expect(rows.nth(1).locator('td').first).not_to_contain_text('原定')
    await expect(page.locator('#quota-day-units')).to_have_text('1.40 份')
    await expect(page.locator('#quota-day-cost')).to_have_text('≈$14.00')

    # Exercise backend grouping and rendering together: a delayed 1% snapshot
    # with a four-minute reset drift must not become a four-minute table row.
    result = subprocess.run(['node', '-e', '''
      const { buildQuotaHistory } = require('./lib/codex-quota-history');
      const at = (hour, minute = 0) => Date.parse(`2026-10-13T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
      const reset = at(15), drift = at(15, 4);
      const snapshot = (timestamp, usedPercent, resetsAt) => ({ timestamp, usedPercent,
        resetsAt, observedAt: new Date(timestamp).toISOString(), windowMinutes: 300 });
      const q = [snapshot(at(10), 1, reset), snapshot(at(10, 10), 20, reset),
        snapshot(at(10, 20), 1, drift), snapshot(at(11), 3, drift), snapshot(at(12), 80, reset)];
      process.stdout.write(JSON.stringify(buildQuotaHistory([], q)));
    '''], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
    import json
    stub.fixture['codexQuota'] = json.loads(result.stdout)
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    rows = page.locator('#quota-window-rows tr')
    await expect(rows).to_have_count(1)
    await expect(rows.locator('td .font-mono').first).to_have_text('10:00–15:00')
    await expect(rows.locator('td').first).not_to_contain_text('原定')
    await expect(page.locator('#quota-day-percent')).to_contain_text('80%')

    # A user-confirmed historical correction remains distinct from a live
    # measurement and shows the included subscription API requests.
    corrected = window('2026-10-13T15:00:00+08:00', '2026-10-13T20:00:00+08:00',
                       '2026-10-13T20:00:00+08:00', 100, 12.22)
    corrected.update(estimateBasis='confirmed100', completionSource='user-confirmed',
                     reached100At=None, subscriptionApiRequests=12, subscriptionApiEquivalentUSD=2,
                     estimatedPer100USD=12.22)
    stub.fixture['codexQuota']['daily'] = [{'date': '2026-10-13', 'usedPercent': 100, 'quotaUnits': 1,
        'apiEquivalentUSD': 12.22, 'averagePer100USD': 12.22, 'comparableUsedPercent': 100,
        'completedWindowCount': 1, 'windows': [corrected]}]
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    rows = page.locator('#quota-window-rows tr')
    await expect(rows).to_have_count(1)
    await expect(rows.locator('td').nth(1)).to_contain_text('100%')
    await expect(rows.locator('.quota-basis')).to_have_text('用户确认用满')
    await expect(rows).to_contain_text('首次用满时间未知')
    await expect(rows).to_contain_text('12 次订阅桥接 API')
    await expect(rows.locator('td').nth(2)).to_contain_text('≈$12.22')

    # Idle account polls report a moving reset five hours ahead. They must
    # neither publish idle intervals nor absorb later real quota and costs.
    result = subprocess.run(['node', '-e', '''
      const { buildQuotaHistory } = require('./lib/codex-quota-history');
      const at = (h, m=0) => Date.parse(`2026-10-13T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+08:00`);
      const q = (t,p,r) => ({ timestamp:t, usedPercent:p, resetsAt:r, windowMinutes:300 });
      const e = (t,r,cost) => ({ timestamp:t, quotaReset:r, cost, speedKnown:true });
      const morning=at(9,59), evening=at(23,3);
      process.stdout.write(JSON.stringify(buildQuotaHistory([e(at(8,20),morning,10),e(at(20),evening,8)],
        [q(at(3,16),0,at(8,16)),q(at(4,58),0,at(9,58)),q(at(5),7,morning),q(at(9,58),94,morning),
         q(at(15,5),0,at(20,5)),q(at(17,58),0,at(22,58)),q(at(18,4),1,evening),q(at(20),60,evening)])));
    '''], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, check=True)
    stub.fixture['codexQuota'] = json.loads(result.stdout)
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    rows = page.locator('#quota-window-rows tr')
    await expect(rows).to_have_count(2)
    await expect(rows.nth(0).locator('td .font-mono').first).to_have_text('04:59–09:59')
    await expect(rows.nth(1).locator('td .font-mono').first).to_have_text('18:03–23:03')
    await expect(page.locator('#quota-day-percent')).to_contain_text('154%')
    await expect(page.locator('#quota-day-cost')).to_have_text('≈$18.00')


async def check_loading_recovery(page, stub):
    stub.fixture['meta'].update(sourceSelectionMode='pending', stale=True, refreshing=True)
    await page.reload(wait_until='domcontentloaded')
    await page.wait_for_function("appState.cachedData?.meta.sourceSelectionMode === 'pending'")
    before = stub.dashboard_requests
    stub.fixture['meta'].update(sourceSelectionMode='selected-agents', stale=False, refreshing=False)
    await page.wait_for_function("appState.cachedData?.meta.sourceSelectionMode === 'selected-agents'", timeout=7000)
    assert stub.dashboard_requests > before, 'Loading totals were never re-read automatically'
    await expect(page.locator('body')).to_have_attribute('data-data-state', 'fresh')
    stub.fail_dashboard = True
    await page.reload(wait_until='domcontentloaded')
    await expect(page.locator('#global-error-banner')).to_be_visible()
    stub.fail_dashboard = False
    await page.wait_for_function('appState.cachedData !== null', timeout=7000)
    await expect(page.locator('#global-error-banner')).not_to_be_visible()


async def check_source_freshness(page, stub):
    stub.fixture['meta']['stale'] = True
    stub.fixture['meta']['lastSuccessfulAt'] = f"{date.today().isoformat()}T01:00:00+08:00"
    await page.reload(wait_until='domcontentloaded')
    await expect(page.locator('body')).to_have_attribute('data-data-state', 'stale')
    stub.fixture['meta']['stale'] = False
    stub.refresh_report = {"success": False, "partial": True,
                           "sources": [{"source": "ccusage", "success": False}]}
    await page.locator('#btn-refresh').click()
    await expect(page.locator('#global-error-banner')).to_be_visible()
    await expect(page.locator('#global-error-text')).to_contain_text('ccusage')
    await expect(page.locator('body')).to_have_attribute('data-data-state', 'stale')


async def check_sources_panel(page, stub):
    await page.set_viewport_size({"width": 390, "height": 844})
    await page.locator('#btn-sources').click()
    await expect(page.locator('#sources-modal')).to_be_visible()
    await expect(page.locator('#sources-rows')).to_contain_text('F:/logs/<img src=x onerror=alert(1)>')
    await expect(page.locator('#sources-rows img')).to_have_count(0)
    await expect(page.locator('#sources-capabilities')).to_contain_text('SQLite 不可用')
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    stub.fail_sources = True
    await page.locator('#sources-retry').click()
    await expect(page.locator('#sources-message')).to_contain_text('状态读取失败')
    await expect(page.locator('#sources-rows')).to_contain_text('Qwen')
    await page.keyboard.press('Escape')
    await expect(page.locator('#sources-modal')).not_to_be_visible()
    await expect(page.locator('#btn-sources')).to_be_focused()


async def check_pricing_and_exports(page, stub):
    for day in stub.fixture['timeline']:
        day['estimatedTokens'] = day['totalTokens'] // 2
    await page.reload(wait_until='domcontentloaded')
    await expect(page.locator('#estimate-summary')).to_contain_text('50.0%')
    await page.locator('#actual-only').check()
    await page.wait_for_function('appState.cachedData.meta.actualOnly === true')
    assert stub.last_dashboard_query['actualOnly'] == ['true']
    await expect(page.locator('#estimate-summary')).to_contain_text('已隐藏估算')
    await page.locator('#pricing-mode').select_option('current')
    await expect(page.locator('#pricing-basis')).to_contain_text('当前费率重算')
    old_version = 'catalog-' + 'a' * 24
    await page.locator('#pricing-mode').select_option(old_version)
    await expect(page.locator('#pricing-basis')).to_contain_text('已保存历史费率')
    assert stub.last_dashboard_query['pricingVersion'] == [old_version]
    await page.locator('#btn-date-today').click()
    for format in ['json', 'csv']:
        async with page.expect_download() as event:
            await page.locator(f'#export-{format}').click()
        download = await event.value
        assert download.suggested_filename == f'agentic-usage.{format}'
        assert stub.exports[-1]['startDate'] == [stub.fixture['meta']['today']]
        assert stub.exports[-1]['endDate'] == [stub.fixture['meta']['today']]
        assert stub.exports[-1]['actualOnly'] == ['true']
        assert stub.exports[-1]['pricingVersion'] == [old_version]


async def check_project_requests(page, stub):
    await open_view(page, 'projects')
    button = page.locator('[data-project-usage]').first
    project_id = await button.get_attribute('data-project-usage')
    await button.click()
    await expect(page.locator('#project-usage-rows tr')).to_have_count(50)
    await expect(page.locator('#project-usage-message')).to_contain_text('65 条记录')
    await page.locator('#project-usage-next').click()
    await expect(page.locator('#project-usage-rows tr')).to_have_count(15)
    await expect(page.locator('#project-usage-rows')).to_contain_text('暂无费率')
    await page.locator('#project-usage-today').click()
    await expect(page.locator('#project-usage-rows tr')).to_have_count(50)
    assert stub.usage_queries[-1]['offset'] == ['0']
    assert stub.usage_queries[-1]['startDate'] == [stub.fixture['meta']['today']]
    await page.locator('#project-usage-modal details summary').click()
    await expect(page.locator('#project-usage-days')).to_contain_text(stub.fixture['meta']['today'])
    async with page.expect_download() as event:
        await page.get_by_role('button', name='导出本工程 JSON', exact=True).click()
    await event.value
    assert stub.exports[-1]['projectId'] == [project_id]
    assert stub.exports[-1]['startDate'] == [stub.fixture['meta']['today']]
    await page.keyboard.press('Escape')
    await expect(page.locator('#project-usage-modal')).not_to_be_visible()
    await expect(button).to_be_focused()


async def check_partial_prices(page, stub):
    today = stub.fixture['meta']['today']
    stub.fixture['meta']['autoReviewNotice'] = '自动审批按用户指定的 GPT-6.1 Terra 费率估算，并非实际扣费。'
    model = {'cost': 0.1, 'tokens': 1000, 'cacheTokens': 200, 'unpricedTokens': 200,
             'company': 'OpenAI', 'agent': 'codex', 'costComplete': False, 'costEstimated': True}
    for day in stub.fixture['timeline']:
        day.update(totalCost=0.1, totalTokens=1000, cacheReadTokens=200,
                   byModel={'codex-auto-review': copy.deepcopy(model)},
                   byCompany={'OpenAI': {'cost': 0.1, 'tokens': 1000, 'cacheTokens': 200}})
    stub.fixture['todaySummary'] = {**copy.deepcopy(stub.fixture['timeline'][-1]),
                                   'images': {'count': 0, 'cost': 0, 'tokens': 0}}
    stub.fixture['imageAnalysis']['daily'] = []
    stub.fixture['codexQuota']['daily'] = [{'date': today, 'apiEquivalentUSD': 0.1, 'costComplete': False,
        'incompleteRequests': 1, 'usedPercent': 50, 'quotaUnits': 0.5, 'quotaObserved': True,
        'completedWindowCount': 0, 'averagePer100USD': None, 'windows': []}]
    await page.evaluate('loadDashboard()')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-cost-sub')).to_contain_text('仅已定价部分')
    await expect(page.locator('#today-models-list')).to_contain_text('已定价部分')
    await expect(page.locator('#today-models-list')).not_to_contain_text('GPT-6.1 Sol')
    await expect(page.locator('#quota-day-cost-note')).to_contain_text('GPT-6.1 Terra')
    await expect(page.locator('#quota-day-cost-note')).to_contain_text('1 次请求金额不完整')
    await expect(page.locator('#today-roi-badge')).to_have_text('完整 API 等值未知')
    await expect(page.locator('#today-quota-badge')).to_have_text('完整用量未知')
    await expect(page.locator('#today-stat-quota-sub')).not_to_contain_text('预算余量')
    await open_view(page, 'timeline')
    await expect(page.locator('#model-rank-list')).to_contain_text('金额不完整')
    for day in stub.fixture['timeline']:
        day['totalCost'] = 0
        day['byModel']['codex-auto-review']['cost'] = 0
        day['byCompany']['OpenAI']['cost'] = 0
    stub.fixture['todaySummary']['totalCost'] = 0
    stub.fixture['todaySummary']['byModel']['codex-auto-review']['cost'] = 0
    stub.fixture['codexQuota']['daily'][0]['apiEquivalentUSD'] = 0
    await page.evaluate('loadDashboard()')
    await open_view(page, 'today')
    await expect(page.locator('#today-stat-cost')).to_have_text('暂无费率')
    await expect(page.locator('#quota-day-cost')).to_have_text('暂无费率')
    await expect(page.locator('#today-stat-roi')).to_have_text('未知')
    await expect(page.locator('#today-stat-month-roi')).to_have_text('未知')
    await open_view(page, 'timeline')
    await expect(page.locator('#model-rank-list')).to_contain_text('暂无费率')
    await page.set_viewport_size({'width': 390, 'height': 844})
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Partial pricing labels overflow a narrow page'


async def check_subscription_references(page, stub):
    await open_view(page, 'today')
    select = page.locator('#today-sub-plan-select')
    await select.select_option('chatgpt_team')  # Existing saved key remains compatible.
    await expect(page.locator('#today-sub-reference')).to_contain_text('ChatGPT Business Standard')
    await expect(page.locator('#today-sub-reference')).to_contain_text('每席位月付')
    await expect(page.locator('#today-sub-reference a')).to_have_attribute('href', 'https://help.openai.com/en/articles/8792828-chatgpt-business-overview')
    await select.select_option('claude_team')
    await expect(page.locator('#today-stat-month-roi-sub')).to_contain_text('订阅费 $25.00')
    await expect(page.locator('#today-sub-reference')).to_contain_text('年付为 $20/席位/月')
    await page.locator('#btn-sub-config').click()
    await page.locator('#sub-custom-fee').fill('0')
    await page.locator('#sub-custom-allowance').fill('0')
    await page.locator('#sub-config-modal .btn-primary').click()
    await expect(page.locator('#sub-config-modal')).not_to_be_visible()
    for selector in ('#today-stat-roi', '#today-stat-month-roi', '#today-stat-quota-pct'):
        await expect(page.locator(selector)).to_have_text('—')
    await expect(page.locator('#today-roi-badge')).to_contain_text('不适用')
    await expect(page.locator('#today-quota-badge')).to_have_text('未设置正数预算')
    await page.reload(wait_until='domcontentloaded')
    await open_view(page, 'today')
    await page.locator('#btn-sub-config').click()
    await expect(page.locator('#sub-custom-fee')).to_have_value('0')
    await expect(page.locator('#sub-custom-allowance')).to_have_value('0')
    await page.locator('#sub-custom-fee').fill('-1')
    await page.locator('#sub-config-modal .btn-primary').click()
    await expect(page.locator('#sub-config-error')).to_be_visible()
    await page.keyboard.press('Escape')
    await page.set_viewport_size({'width': 390, 'height': 844})
    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')


CHECKS = [("sources panel and failure recovery", check_sources_panel),
          ("subscription references and zero amounts", check_subscription_references),
          ("partial prices and reviewer assumptions", check_partial_prices),
          ("automatic loading recovery", check_loading_recovery),
          ("pricing versions and filtered exports", check_pricing_and_exports),
          ("project daily and request drilldown", check_project_requests),
          ("source freshness and partial refresh", check_source_freshness),
          ("today cost scope", check_today_cost_scope),
          ("complete usage totals", check_complete_totals), ("quota window intervals", check_quota_windows),
          ("Codex live usage", check_codex_live), ("Codex live controls", check_codex_live_controls),
          ("Codex image activity", check_codex_image_activity),
          ("responsive layout", check_layout), ("keyboard navigation", check_navigation),
          ("chart continuity and ranking", check_chart), ("date validation", check_dates),
          ("pagination and empty states", check_pagination), ("modal focus and Escape", check_modals),
          ("image lightbox", check_lightbox), ("requests and retained data", check_requests),
          ("reduced motion", check_reduced_motion), ("sorting scope and recovery", check_refinements),
          ("complete image catalog", check_full_catalog), ("scoped data presentation", check_data_presentation),
          ("calendar gaps and chart context", check_calendar_context), ("complete thumbnail presentation", check_gallery_presentation),
          ("today project context", check_today_project_context)]


async def run(args):
    failures = []
    selected = [(name, check) for name, check in CHECKS if not args.check or name in args.check]
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=not args.headed)
        for name, check in selected:
            context = await browser.new_context(viewport={"width": 1440, "height": 1000}, locale="zh-CN", timezone_id="Asia/Shanghai")
            stub = ApiStub()
            await context.route("**/api/**", stub.handle)
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(error.stack or str(error)))
            page.set_default_timeout(7000)
            try:
                if check is check_reduced_motion:
                    await page.emulate_media(reduced_motion="reduce")
                await ready(page, args.base_url)
                await check(page, stub)
                assert not errors, f"Browser exceptions: {errors}"
                print(f"PASS {name}")
            except Exception as error:
                failures.append(name)
                print(f"FAIL {name}: {error}")
                if errors:
                    print(f"Browser exceptions: {errors}")
                if args.artifacts:
                    folder = Path(args.artifacts).resolve()
                    folder.mkdir(parents=True, exist_ok=True)
                    await page.screenshot(path=str(folder / f"{name.replace(' ', '-')}.png"), full_page=True)
            finally:
                await context.close()
        await browser.close()
    print(f"{len(selected) - len(failures)}/{len(selected)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    # Windows consoles may otherwise fail to print Unicode browser diagnostics.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:4242")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--artifacts", help="Optional folder for screenshots of failures")
    parser.add_argument("--check", action="append", choices=[name for name, _ in CHECKS],
                        help="Run a named check only; repeat to select several checks")
    raise SystemExit(asyncio.run(run(parser.parse_args())))
