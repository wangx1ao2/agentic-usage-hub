"""Capture the user's public museum UI and edit out loading waits; no mock data."""
import asyncio,json,re,subprocess,sys,time
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf8')
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output/mind-museum'
URL='https://personal-mind-museum.fuzzydrum8.chatgpt.site'
FFMPEG=next((OUT/'runtime/imageio_ffmpeg/binaries').glob('ffmpeg-*.exe'))
CAPTION_CSS='''#portfolio-recording-caption{position:fixed;z-index:2147483647;left:30px;bottom:22px;max-width:1080px;padding:12px 20px;border:1px solid #bda37c66;border-radius:7px;background:#10120feb;color:#eee7d7;pointer-events:none;font-family:"Microsoft YaHei",sans-serif;box-shadow:0 8px 24px #0003}#portfolio-recording-caption b{display:block;font-size:21px;font-weight:500;line-height:1.4}#portfolio-recording-caption p{font-size:12px;margin:5px 0 0;color:#c1b394}#portfolio-recording-caption small{font:9px/1.5 "Microsoft YaHei",sans-serif;display:block;letter-spacing:1px;color:#9d998a;margin-bottom:4px}'''

async def main():
 OUT.mkdir(exist_ok=True);(OUT/'raw').mkdir(exist_ok=True)
 shots=[];segments=[];errors=[]
 async with async_playwright() as pw:
  b=await pw.chromium.launch()
  c=await b.new_context(viewport={'width':1600,'height':900},device_scale_factor=1,record_video_dir=str(OUT/'raw'),record_video_size={'width':1600,'height':900})
  p=await c.new_page();epoch=time.monotonic();raw=await p.video.path()
  p.on('pageerror',lambda e:errors.append(str(e)))
  async def ready():
   await p.evaluate('document.fonts.ready')
   if '/chinese-history/read/' in p.url:
    # The reader pre-allocates thumbnails in a clipped sidebar. Only its main
    # artwork is on screen; waiting for every deferred thumbnail never settles.
    await p.locator('#reading img').first.evaluate('image=>image.decode()')
    await p.wait_for_timeout(600)
    return
   await p.wait_for_function('''()=>[...document.images].filter(i=>{const r=i.getBoundingClientRect();return (i.currentSrc||i.getAttribute('src'))&&r.width>0&&r.top<innerHeight&&r.bottom>0}).every(i=>i.complete&&i.naturalWidth>0)''',timeout=40000)
   await p.wait_for_timeout(600)
  async def go(path):
   await p.goto(URL+path,wait_until='domcontentloaded',timeout=60000)
   await p.wait_for_timeout(1100)
  async def caption(title,description):
   if not await p.locator('#portfolio-recording-caption').count():
    await p.add_style_tag(content=CAPTION_CSS)
    await p.evaluate('''()=>{const e=document.createElement('div');e.id='portfolio-recording-caption';e.innerHTML='<small>PERSONAL MIND MUSEUM · 在线页面实录</small><b></b><p></p>';document.body.append(e)}''')
   await p.evaluate('''([t,d])=>{const e=document.getElementById('portfolio-recording-caption');e.querySelector('b').textContent=t;e.querySelector('p').textContent=d}''',[title,description])
  async def snap(number,title,module):
   await p.evaluate('''()=>{const e=document.getElementById('portfolio-recording-caption');if(e)e.style.visibility='hidden'}''')
   await ready();png=OUT/f'museum-{number:02}.png';await p.screenshot(path=str(png))
   with Image.open(png) as im:im.convert('RGB').save(OUT/f'museum-{number:02}.webp',quality=85,method=6);width,height=im.size
   shots.append({'src':f'assets/screenshots/museum-{number:02}.webp','title':title,'module':module,'note':'已上线站点真实截图 · 2026.10.21；作品来源标识保留原站信息','width':width,'height':height})
   await p.evaluate('''()=>{const e=document.getElementById('portfolio-recording-caption');if(e)e.style.visibility='visible'}''')
   print('Screenshot',number,title,flush=True)
  async def start(title,description):
   await caption(title,description);return time.monotonic()-epoch
  def finish(start,title,description):
   segments.append({'start':start,'end':time.monotonic()-epoch,'title':title,'description':description})
   (OUT/'recording-progress.json').write_text(json.dumps({'raw':str(raw),'epoch':epoch,'shots':shots,'segments':segments},ensure_ascii=False,indent=2),encoding='utf8')
  async def hold(seconds):await p.wait_for_timeout(seconds*1000)

  await go('/');await ready();await hold(1.5)
  await snap(1,'宇宙入口与八展厅导航','博物馆入口')
  title='01 / 从个人的内心宇宙出发';desc='以宇宙意象作为入口，连接八个不同主题的展厅。'
  s=await start(title,desc);await p.mouse.move(1280,430,steps=20);await hold(4.5);finish(s,title,desc)

  await p.locator('#exhibitions').evaluate('e=>scrollTo({top:e.getBoundingClientRect().top+scrollY-80,behavior:"instant"})');await ready()
  await snap(2,'八个展厅与主题／系列展分类','展厅导览')
  title='02 / 按主题选择一条参观路线';desc='主题展围绕问题展开，系列展按篇章持续深入。'
  s=await start(title,desc);await hold(2)
  await p.mouse.wheel(0,330);await hold(3);finish(s,title,desc)

  await go('/exhibitions/human-universe/');await ready();await snap(3,'人与宇宙主题展厅','主题展览')
  await p.locator('#room-works').scroll_into_view_if_needed()
  first=p.get_by_role('button',name='欣赏《宇宙中的孤岛》',exact=True)
  await first.wait_for(timeout=45000)
  await first.evaluate('e=>scrollTo({top:e.getBoundingClientRect().top+scrollY-190,behavior:"instant"})');await ready()
  await snap(4,'围绕图像与问题组织精选作品','作品策展')
  title='03 / 让作品组成有顺序的叙事';desc='从人的尺度出发，沿着图像、文字与系列继续观看。'
  s=await start(title,desc);await hold(3);await p.mouse.move(800,460,steps=18);await hold(2.2);finish(s,title,desc)

  await first.click();await p.get_by_role('dialog').wait_for();await ready();await snap(5,'沉浸式作品浏览与详情','作品浏览器')
  title='04 / 进入作品，连续欣赏';desc='独立浏览器支持前后切换，并保留作品详情入口。'
  s=await start(title,desc);await hold(2)
  await p.get_by_role('button',name='下一件作品',exact=True).click();await ready();await hold(1)
  await p.get_by_role('button',name='显示作品详情',exact=True).click();await hold(2);finish(s,title,desc)
  await p.get_by_role('button',name='关闭作品浏览器',exact=True).click()

  await go('/library/');await p.locator('.artwork-image-button').first.wait_for(timeout=45000)
  # The public library exposes the real search field; no catalog is injected.
  search=p.get_by_placeholder(re.compile('搜索作品名'))
  await search.evaluate('e=>scrollTo({top:e.getBoundingClientRect().top+scrollY-180,behavior:"instant"})');await ready()
  title='05 / 在在线珍藏里，找到想看的作品';desc='按目录与创作方式浏览，再用关键词缩小范围。'
  await caption(title,desc);s=time.monotonic()-epoch;await hold(1.5)
  await search.press_sequentially('银河',delay=450);await hold(1.5);await ready()
  await snap(6,'在线图库与关键词检索','图库搜索');await hold(2);finish(s,title,desc)

  await go('/exhibitions/chinese-history/read/?era=07')
  await p.locator('#history-topic-title').wait_for(timeout=45000)
  await p.locator('#reading img').first.wait_for(timeout=45000)
  await ready();await snap(7,'按时代与篇章浏览中国历史系列','系列阅读')
  title='06 / 把系列作品，读成一场长篇漫游';desc='按时代进入篇章，让浏览从单张作品延伸到完整主题。'
  s=await start(title,desc);await hold(5);finish(s,title,desc)
  end=time.monotonic()-epoch
  await c.close()
  mobile=await b.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  mp=await mobile.new_page();await mp.goto(URL,wait_until='domcontentloaded',timeout=60000);await mp.wait_for_timeout(2600)
  await mp.screenshot(path=str(OUT/'museum-08.png'))
  with Image.open(OUT/'museum-08.png') as im:im.convert('RGB').save(OUT/'museum-08.webp',quality=85,method=6)
  shots.append({'src':'assets/screenshots/museum-08.webp','title':'手机端入口与响应式导航','module':'移动端','note':'已上线站点真实手机视口截图 · 390 × 844','width':390,'height':844})
  await b.close()

 def probe(file):
  result=subprocess.run([str(FFMPEG),'-hide_banner','-i',str(file)],capture_output=True,text=True,encoding='utf8',errors='replace')
  match=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',result.stderr)
  assert match,result.stderr
  return int(match[1])*3600+int(match[2])*60+float(match[3])
 raw_duration=probe(raw);offset=0
 filters=[]
 for i,scene in enumerate(segments):
  start=min(scene['start'],raw_duration-.08);stop=min(scene['end'],raw_duration)
  pad=max(0,scene['end']-stop)
  filters.append(f'[0:v]trim=start={start:.3f}:end={stop:.3f},setpts=PTS-STARTPTS'+(f',tpad=stop_mode=clone:stop_duration={pad:.3f}' if pad else '')+f'[v{i}]')
 filters.append(''.join(f'[v{i}]' for i in range(len(segments)))+f'concat=n={len(segments)}:v=1:a=0[out]')
 target=OUT/'museum-showcase.mp4'
 subprocess.run([str(FFMPEG),'-hide_banner','-loglevel','error','-i',str(raw),'-filter_complex',';'.join(filters),'-map','[out]','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-r','30','-movflags','+faststart','-an','-y',str(target)],check=True)
 duration=probe(target);assert target.stat().st_size<25*1024*1024
 with Image.open(OUT/'museum-01.png') as im:im.convert('RGB').save(OUT/'museum-poster.webp',quality=87,method=6)
 def stamp(n):
  ms=round(n*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
 captions=['WEBVTT',''];clock=0;chapters=[]
 for scene in segments:
  stop=min(duration,clock+scene['end']-scene['start'])
  captions.extend([f'{stamp(clock)} --> {stamp(stop)}',scene['title'],scene['description'],''])
  chapters.append({'start':round(clock,2),'end':round(stop,2),'title':scene['title'],'description':scene['description']});clock=stop
 (OUT/'museum-zh.vtt').write_text('\n'.join(captions),encoding='utf8')
 metadata={'source_url':URL,'source_project_id':'appgprj_6ad1e67418c08191b923e633d72aeca8','captured_on':'2026-10-21','duration':duration,'width':1600,'height':900,'codec':'h264','bytes':target.stat().st_size,'screens':shots,'chapters':chapters,'browser_errors':errors,'raw':str(raw),'editing':'Actual public UI, loading waits removed; no mocked responses or invented artworks.'}
 (OUT/'museum-metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps({k:v for k,v in metadata.items() if k not in ['screens','chapters','raw']},ensure_ascii=False),flush=True)

asyncio.run(main())
