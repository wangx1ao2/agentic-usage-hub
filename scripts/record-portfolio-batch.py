"""Record real project interfaces with clearly disclosed local demo fixtures."""
import argparse,asyncio,json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'media'))
from demo_support import OUT,ROOT,Story,add_caption,book_api,finish_video
from playwright.async_api import async_playwright

async def click(page,locator):
    box=await locator.bounding_box()
    if box:await page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2,steps=18)
    await locator.click()

async def scroll(page,selector):
    await page.locator(selector).first.evaluate('(e)=>window.scrollTo({top:e.getBoundingClientRect().top+scrollY-105,behavior:"smooth"})')
    await page.wait_for_timeout(950)

async def books(page,s):
    await s.caption('阅见 · 从好奇心开始找书','用自然语言表达阅读兴趣，再探索推荐理由与书籍关联。');await s.wait(3)
    await click(page,page.get_by_role('button',name='哲学与自我探索 ↗'));await s.wait(2)
    await s.caption('01 / 表达需求，生成示例书单','实际前端交互；推荐结果由本地演示接口返回。')
    await click(page,page.get_by_role('button',name='寻找下一本书 ↗'));await page.locator('.book-card').first.wait_for()
    await scroll(page,'.results-section');await s.wait(4)
    await page.screenshot(path=str(OUT/'books-poster.png'))
    await s.caption('02 / 查看推荐理由与图书详情','查看书籍标签与简介，辅助决定从哪一本开始。')
    await click(page,page.get_by_role('button',name='查看详情').first);await s.wait(4)
    await click(page,page.get_by_role('button',name='关闭',exact=True).last);await s.wait(.5)
    await s.caption('03 / 沿着知识关联，继续探索','从相似、对比与后续阅读三个方向扩展书单。')
    await click(page,page.get_by_role('button',name='知识关联').first);await s.wait(5)
    await click(page,page.get_by_role('button',name='关闭',exact=True).last);await s.wait(1.5)

async def spirit(page,s):
    await s.caption('Spirit Compass · 把自我探索变成一次旅程','从逐题作答，到意义排序，再到可视化报告。');await s.wait(3)
    await click(page,page.get_by_role('button',name='开始测试',exact=True).first);await s.wait(.8)
    await s.caption('01 / 逐题作答，表达当下的感受','此视频使用示例答案；结果仅作自我探索参考。')
    for value in ['4','3']:
        await click(page,page.locator(f'.likert-option[data-value="{value}"]'));await s.wait(1.4)
    await s.caption('02 / 排列最重视的意义来源','演示中省略部分题目，继续选择三项意义来源。')
    await page.evaluate('''()=>{state.answers=Array.from({length:TOTAL_QUESTIONS},(_,i)=>[4,3,5,2,4,3,5][i%7]);state.answers[DISTRESS_QUESTION_INDEX]=2;state.currentQuestion=TOTAL_QUESTIONS;renderQuestion()}''')
    await s.wait(1)
    for i in range(3):
        await click(page,page.locator('.source-card').nth(i));await s.wait(.65)
    await s.wait(1.5);await click(page,page.locator('#btnNext'))
    await page.locator('#page-result.active').wait_for(timeout=15000)
    await s.caption('03 / 生成专属的探索报告','示例作答经过项目自身的评分与报告逻辑生成结果。');await s.wait(4)
    await page.screenshot(path=str(OUT/'spirit-poster.png'))
    await scroll(page,'#resultRadar');await s.caption('04 / 用维度图，看见倾向与差异','结合维度分布阅读结果，继续探索具体建议。');await s.wait(4)
    await scroll(page,'#resultPractical');await s.wait(4)

async def b2b(page,s):
    async def go(path):
        await page.goto('http://127.0.0.1:4353'+path,wait_until='networkidle')
        await add_caption(page,'ScrewSource','实际站点 · 询盘不提交',True)
    await s.caption('ScrewSource · 从产品发现到询盘准备','面向海外采购的紧固件目录与产品信息。');await s.wait(3)
    await go('/en/products/');await s.caption('01 / 按材质进入产品目录','在不锈钢与碳钢系列中，逐步收敛采购范围。');await s.wait(2.5)
    await go('/en/products/stainless/hex-socket-screws/');await s.caption('02 / 按品类继续筛选','查看实际产品系列与标准，定位需要的规格。');await s.wait(3)
    links=await page.locator('a').evaluate_all('(els)=>els.map(e=>e.getAttribute("href")).filter(h=>h&&h.startsWith("/en/products/stainless/hex-socket-screws/")&&h.split("/").length>6)')
    if not links:raise RuntimeError('No actual product links')
    await go(links[0]);await s.caption('03 / 阅读产品详情与规格信息','通过标准、尺寸与产品图，整理采购要求。');await s.wait(4)
    await page.screenshot(path=str(OUT/'b2b-poster.png'))
    await page.mouse.wheel(0,460);await s.wait(2.5)
    await go('/en/rfq/');await s.caption('04 / 让需求进入结构化询盘','仅填写公开示例；本次展示不提交询盘。')
    await page.locator('input[name="name"]').first.fill('Demo Buyer');await s.wait(.5)
    await page.locator('input[name="email"]').first.fill('buyer@example.com')
    await page.locator('input[name="company"]').first.fill('Example Procurement')
    country=page.locator('[name="country"]').first
    if await country.evaluate('(e)=>e.tagName')=='SELECT':await country.select_option(label='Germany')
    else:await country.fill('Germany')
    await page.locator('[name="product_ref"]').first.fill('304 stainless hex socket screw, M3 x 10')
    await page.locator('[name="quantity"]').first.fill('5000 pieces')
    await page.locator('textarea[name="message"]').first.fill('Demo only: please confirm dimensions, finish and packaging.')
    await scroll(page,'#rfq-main');await s.wait(4)

async def novel(page,s):
    await s.caption('Novel Writer · 让故事继续生长','把小说、章节与辅助改写放进同一套写作工作台。');await s.wait(3)
    await click(page,page.get_by_text('潮汐之后',exact=True));await s.wait(2)
    await s.caption('01 / 从作品进入章节编辑','这里使用独立示例作品，不读取桌面上的写作资料。')
    await click(page,page.get_by_role('button',name='继续写作'));await s.wait(2)
    await page.locator('.tiptap p').first.evaluate('''e=>{const range=document.createRange();range.selectNodeContents(e);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new Event('selectionchange'))}''')
    await page.wait_for_timeout(450)
    await click(page,page.get_by_role('button',name='AI 改写选中文本'))
    await s.caption('02 / 选取文本，配置改写方向','真实编辑界面；本地模拟接口返回预设的原创示例。');await s.wait(3)
    await click(page,page.get_by_role('button',name='生成改写'));await s.wait(3)
    await s.caption('03 / 对照原稿与建议稿','逐段检查改动，再决定接受、重试或放弃。')
    await page.get_by_role('button',name='接受',exact=True).scroll_into_view_if_needed();await s.wait(3)
    await page.screenshot(path=str(OUT/'novel-poster.png'))
    await click(page,page.get_by_role('button',name='接受',exact=True));await s.wait(1)
    await s.caption('04 / 将选中的建议写回正文','完成一次“选择—改写—比较—接受”的交互闭环。');await s.wait(4)

async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--project',choices=['books','spirit','b2b','novel','all'],default='all');args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);results=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.launch()
        for key in (['books','spirit','b2b','novel'] if args.project=='all' else [args.project]):
            context=await browser.new_context(viewport={'width':1600,'height':900},device_scale_factor=1,record_video_dir=str(OUT/'raw'),record_video_size={'width':1600,'height':900})
            if key=='books':await context.route('**/api/**',book_api)
            if key=='novel':await context.add_init_script(path=str(ROOT/'scripts/media/novel-demo-bridge.js'))
            if key=='spirit':await context.add_init_script("localStorage.setItem('spirit-compass-theme','dark')")
            if key=='b2b':await context.route('**/api/rfq/**',lambda route:route.abort())
            page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            ports={'books':4351,'spirit':4352,'b2b':4353,'novel':4354}
            await page.goto(f'http://127.0.0.1:{ports[key]}/'+('en/' if key=='b2b' else ''),wait_until='networkidle');await page.wait_for_timeout(700)
            await add_caption(page,{'books':'阅见','spirit':'Spirit Compass','b2b':'ScrewSource','novel':'Novel Writer'}[key],{'books':'示例书单 · 演示接口','spirit':'示例作答 · 非诊断','b2b':'实际站点 · 询盘不提交','novel':'实际前端 · 模拟改写'}[key],key in ['books','b2b'])
            if key=='novel':await page.add_style_tag(content='#demo-caption{left:250px;right:410px;width:auto;max-width:none;transform:none}#demo-caption b{font-size:21px}#demo-caption{display:block}#demo-caption small{display:block;text-align:left;margin-top:6px}')
            story=Story(page)
            try:await globals()[key](page,story)
            except Exception:
                await page.screenshot(path=str(OUT/f'{key}-failure.png'));raise
            duration=time.monotonic()-story.started
            raw=await page.video.path();await context.close()
            if errors:raise RuntimeError(f'{key}: {errors}')
            result=await asyncio.to_thread(finish_video,raw,OUT,key,story.chapters,duration)
            print(json.dumps(result,ensure_ascii=False),flush=True);results.append(result)
        await browser.close()
    (OUT/'last-batch.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
if __name__=='__main__':asyncio.run(main())
