"""Record a visitor-facing project demo using the real UI and isolated sample data.

python scripts/record-portfolio-demo.py --output output/portfolio-showcase
Requires an existing local UI server, Playwright, and ffmpeg on PATH.
"""
import argparse
import asyncio
import copy
import importlib.util
import json
import math
import shutil
import subprocess
import time
from datetime import date, timedelta
from pathlib import Path

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ui', ROOT/'tests/frontend-ui-check.py')
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)


def sample_data():
    stub = ui.ApiStub()
    offset = (date(2026, 10, 18) - date.fromisoformat(stub.fixture['meta']['today'])).days
    def shift(value):
        if isinstance(value, dict): return {k: shift(v) for k,v in value.items()}
        if isinstance(value, list): return [shift(v) for v in value]
        if isinstance(value, str) and len(value) == 10:
            try: return (date.fromisoformat(value)+timedelta(days=offset)).isoformat()
            except ValueError: pass
        return value
    fixture = stub.fixture = shift(stub.fixture)
    for index, day in enumerate(fixture['timeline']):
        for model_index, model in enumerate(day['byModel'].values()):
            factor = .6 + (math.sin(index*.58 + model_index*.3)+1)*.55
            model['cost'] = round(model['cost']*factor, 4)
            model['tokens'] = round(model['tokens']*factor)
        day['totalCost'] = sum(m['cost'] for m in day['byModel'].values())
        day['totalTokens'] = sum(m['tokens'] for m in day['byModel'].values())
        day['cacheReadTokens'] = round(day['totalTokens']*.64)
        day['byCompany']['OpenAI'].update(cost=day['totalCost'], tokens=day['totalTokens'])
    fixture['todaySummary'].update(copy.deepcopy(fixture['timeline'][-1]))
    names = ['示例项目 · 内容工作台','示例项目 · 数据助手','示例项目 · 知识库',
             '示例项目 · 用量工具','示例项目 · 创作平台','示例项目 · 自动化流程']
    fixture['projects'] = fixture['projects'][-6:]
    for i, project in enumerate(fixture['projects']):
        project.update(name=names[i], desc='按工程查看 AI 编程工具的使用记录',
                       primaryPath=f'F:/demo/workspace-{i+1:02}', paths=[f'F:/demo/workspace-{i+1:02}'])
    stub.live_fixture['sessions'][0].update(cwd='F:/demo/workspace-01', sessionId='demo-session')
    return stub


async def record(args):
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    stub = sample_data()
    chapters, errors = [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width':1600,'height':900},
            locale='zh-CN', timezone_id='Asia/Shanghai', color_scheme='dark',
            record_video_dir=str(output/'raw'), record_video_size={'width':1600,'height':900})
        await context.add_init_script("localStorage.setItem('agentic_theme_mode','dark');localStorage.setItem('agentic_motion_mode','full')")
        await context.route('**/api/**', stub.handle)
        page = await context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        video = page.video
        await ui.ready(page, args.base_url)
        await page.add_style_tag(content='''
          #showcase-caption{position:fixed;z-index:20000;left:50%;bottom:22px;transform:translateX(-50%);
            width:calc(100% - 240px);max-width:1240px;padding:18px 24px;border:1px solid #4d788b66;
            border-radius:12px;background:#0a1422f2;box-shadow:0 15px 50px #0006;pointer-events:none;
            display:flex;align-items:center;justify-content:space-between;gap:24px;color:#eff7ff}
          #showcase-caption b{display:block;font:600 23px/1.4 "Segoe UI","Microsoft YaHei",sans-serif}
          #showcase-caption p{margin:5px 0 0;font-size:14px;color:#a4b6ce}
          #showcase-caption small{font:11px/1.6 "Microsoft YaHei",sans-serif;color:#99aec6;text-align:right;white-space:nowrap}
          #showcase-cursor{position:fixed;left:-100px;top:-100px;width:19px;height:19px;border-radius:50%;
            border:2px solid #9aecff;background:#58d8f544;z-index:21000;pointer-events:none;transform:translate(-50%,-50%)}
        ''')
        await page.evaluate('''() => {
          const caption=document.createElement('div');caption.id='showcase-caption';
          caption.innerHTML='<div><b></b><p></p></div><small>AGENTIC USAGE HUB<br>本地界面 · 示例数据</small>';
          document.body.appendChild(caption);
          const cursor=document.createElement('div');cursor.id='showcase-cursor';document.body.appendChild(cursor);
          document.addEventListener('pointermove',e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
          document.addEventListener('pointerdown',()=>cursor.animate([{boxShadow:'0 0 0 0 #9aecff99'},{boxShadow:'0 0 0 15px #9aecff00'}],{duration:450}));
        }''')
        started = time.monotonic()
        async def caption(title, text):
            chapters.append({'start':round(time.monotonic()-started,2), 'title':title, 'text':text})
            await page.evaluate('''([title,text])=>{
              const node=document.getElementById('showcase-caption');
              node.querySelector('b').textContent=title;node.querySelector('p').textContent=text;
              node.animate([{opacity:0},{opacity:1}],{duration:300});
            }''', [title,text])
        await caption('把分散的 AI 使用记录，放进同一套看板', 'Token、缓存与 API 等值参考，按统一口径查看。')
        await ui.open_view(page, 'today')
        await page.wait_for_timeout(4300)
        await caption('从总量，看到每一天的变化', '切换时间范围与统计维度，观察模型使用趋势。')
        await ui.open_view(page, 'timeline')
        await page.wait_for_timeout(1500)
        await page.locator('#axis-tokens').click()
        await page.evaluate("window.scrollTo({top:410,behavior:'smooth'})")
        await page.wait_for_timeout(4200)
        await page.screenshot(path=str(output/'agentic-usage-hub-poster.png'))
        await caption('按工程归因，让使用记录有据可查', '排序、展开详情，定位具体工程的消耗与来源。')
        await page.evaluate('scrollTo(0,0)')
        await ui.open_view(page, 'projects')
        await page.wait_for_timeout(1800)
        await page.locator('#proj-sort-active').click()
        await page.evaluate("window.scrollTo({top:350,behavior:'smooth'})")
        await page.wait_for_timeout(1300)
        await page.locator('.project-expand-btn').first.click()
        await page.wait_for_timeout(3300)
        await caption('实时检查，保留可观察的变化', '速率为最近 60 秒窗口平均值；估算金额不等于订阅账单。')
        await page.evaluate('scrollTo(0,0)')
        await ui.open_view(page, 'live')
        await expect(page.locator('#codex-live-total')).not_to_have_text('—')
        await page.wait_for_timeout(1200)
        for index in range(5):
            value = 110 + index*26
            stub.live_fixture['generatedAt'] += 2000
            for row in [stub.live_fixture['totals'],stub.live_fixture['sessions'][0]]:
                row.update(tokensPerSecond=value, inputTokensPerSecond=round(value*.12,1),
                           cacheReadTokensPerSecond=round(value*.78,1),outputTokensPerSecond=round(value*.1,1))
            await page.locator('#codex-live-refresh').click()
            await page.wait_for_timeout(1100)
        await page.wait_for_timeout(1200)
        await context.close()
        raw = Path(await video.path())
        await browser.close()
    assert not errors, errors
    # Keep the native 16:9 frame; no mobile letterboxing or test annotation.
    target = output/'agentic-usage-hub-showcase.mp4'
    subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-i',str(raw),
        '-c:v','libx264','-preset','medium','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart','-an','-y',str(target)],check=True)
    subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-i',str(output/'agentic-usage-hub-poster.png'),
        '-quality','85','-y',str(output/'agentic-usage-hub-poster.webp')],check=True)
    metadata = json.loads(subprocess.check_output([shutil.which('ffprobe'),'-v','error','-show_entries',
        'format=duration,size:stream=width,height,codec_name','-of','json',str(target)]))
    metadata.update(chapters=chapters, data='Isolated sample data; real application UI', page_errors=errors)
    (output/'showcase-metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
    def stamp(seconds):
        ms=round(seconds*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
    cues=['WEBVTT','']
    duration=float(metadata['format']['duration'])
    for i, chapter in enumerate(chapters):
        end=chapters[i+1]['start'] if i+1<len(chapters) else duration
        cues += [f'{stamp(chapter["start"])} --> {stamp(end)}',chapter['title'],chapter['text'],'']
    (output/'agentic-usage-hub-zh.vtt').write_text('\n'.join(cues),encoding='utf8')
    print(json.dumps({'video':str(target),'duration':duration,'bytes':target.stat().st_size,'page_errors':errors}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url',default='http://127.0.0.1:4242')
    parser.add_argument('--output',default=str(ROOT/'output/portfolio-showcase'))
    asyncio.run(record(parser.parse_args()))
