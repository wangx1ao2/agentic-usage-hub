"""Shared recording fixtures and captions; all writes stay in demo contexts."""
import asyncio
import json
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/portfolio-videos'

BOOKS=[
    {'id':1,'title':'苏菲的世界','author':'乔斯坦·贾德','tags':'哲学入门 / 思想故事','rating':8.8,'rating_count':0,'summary':'演示简介：以故事作为阅读入口，沿着问题认识不同的哲学思想。'},
    {'id':2,'title':'哲学的故事','author':'威尔·杜兰特','tags':'哲学史 / 人物思想','rating':8.7,'rating_count':0,'summary':'演示简介：从思想家的经历切入，建立哲学阅读的整体线索。'},
    {'id':3,'title':'人生的智慧','author':'阿图尔·叔本华','tags':'人生 / 自我探索','rating':8.5,'rating_count':0,'summary':'演示简介：围绕日常生活与个人选择组织进一步阅读。'},
    {'id':4,'title':'西方哲学史','author':'伯特兰·罗素','tags':'哲学史 / 延伸阅读','rating':8.9,'rating_count':0,'summary':'演示简介：作为进阶阅读候选，继续探索思想发展的历史。'}
]

async def book_api(route):
    path=urlparse(route.request.url).path
    headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}
    if route.request.method=='OPTIONS':
        await route.fulfill(status=204,headers=headers);return
    if path.endswith('/recommend/personalized'):
        await asyncio.sleep(.8)
        payload={'intent':{'domains':['哲学','自我探索'],'difficulty':'入门','style':'通俗'},'recommendations':[
            {'book':book,'similarity_score':.91-i*.05,'recommendation_reason':'演示推荐理由：从问题与故事切入，建立哲学阅读的第一条线索。','highlights':'本段为界面演示摘要，非原书引文。'} for i,book in enumerate(BOOKS)]}
    elif '/recommend/knowledge/' in path:
        payload={'source_book':BOOKS[0],'relations':[{'title':b['title'],'relation':r,'reason':'演示关联，供继续探索阅读方向。'} for b,r in zip(BOOKS[1:],['相似','对比','后续'])]}
    elif '/book/' in path:
        payload=next((b for b in BOOKS if str(b['id'])==path.rsplit('/',1)[-1]),BOOKS[0])
    else:
        await route.abort();return
    await route.fulfill(json=payload,headers=headers)

async def add_caption(page, brand, note, light=False):
    background='#f6f7f0f5' if light else '#0b1525f2'
    foreground='#203b2e' if light else '#edf5ff'
    await page.add_style_tag(content=f'''
      #demo-caption{{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99999;pointer-events:none;
        width:calc(100% - 180px);max-width:1300px;border:1px solid #8ba38766;border-radius:12px;
        background:{background};color:{foreground};padding:17px 23px;box-shadow:0 10px 40px #0002;
        display:flex;justify-content:space-between;align-items:center;gap:24px}}
      #demo-caption b{{display:block;font:600 23px/1.4 'Microsoft YaHei','Segoe UI',sans-serif}}
      #demo-caption p{{margin:5px 0 0;font:14px/1.5 'Microsoft YaHei',sans-serif;opacity:.8}}
      #demo-caption small{{font:11px/1.6 'Microsoft YaHei',sans-serif;text-align:right;white-space:nowrap;opacity:.8}}
      #demo-cursor{{position:fixed;left:-100px;top:-100px;width:18px;height:18px;border:2px solid #59a48b;
        background:#59a48b35;z-index:100000;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%)}}
    ''')
    await page.evaluate('''([brand,note])=>{
      const box=document.createElement('div');box.id='demo-caption';
      box.innerHTML='<div><b></b><p></p></div><small></small>';box.querySelector('small').textContent=brand+' · '+note;document.body.append(box);
      const cursor=document.createElement('div');cursor.id='demo-cursor';document.body.append(cursor);
      document.addEventListener('pointermove',e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
      document.addEventListener('pointerdown',()=>cursor.animate([{boxShadow:'0 0 0 0 #59a48b88'},{boxShadow:'0 0 0 16px #59a48b00'}],{duration:450}));
    }''',[brand,note])

class Story:
    def __init__(self,page):self.page=page;self.started=time.monotonic();self.chapters=[]
    async def caption(self,title,description):
        self.chapters.append({'start':round(time.monotonic()-self.started,2),'title':title,'description':description})
        await self.page.evaluate('''([title,text])=>{const b=document.getElementById('demo-caption');b.querySelector('b').textContent=title;b.querySelector('p').textContent=text;b.animate([{opacity:0},{opacity:1}],{duration:260})}''',[title,description])
    async def wait(self,seconds):await self.page.wait_for_timeout(seconds*1000)

def finish_video(raw,folder,key,chapters,story_duration=None):
    target=folder/f'{key}-showcase.mp4'
    raw_duration=float(subprocess.check_output([shutil.which('ffprobe'),'-v','error','-show_entries','format=duration','-of','csv=p=0',str(raw)]))
    trim=['-ss',str(max(0,raw_duration-story_duration))] if story_duration else []
    subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error',*trim,'-i',str(raw),'-c:v','libx264','-preset','medium','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart','-an','-y',str(target)],check=True)
    subprocess.run([shutil.which('ffmpeg'),'-hide_banner','-loglevel','error','-i',str(folder/f'{key}-poster.png'),'-quality','85','-y',str(folder/f'{key}-poster.webp')],check=True)
    meta=json.loads(subprocess.check_output([shutil.which('ffprobe'),'-v','error','-show_entries','format=duration,size:stream=width,height,codec_name','-of','json',str(target)]))
    duration=float(meta['format']['duration'])
    def stamp(value):
        ms=round(value*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
    cues=['WEBVTT','']
    for i,c in enumerate(chapters):
        end=chapters[i+1]['start'] if i+1<len(chapters) else duration
        cues += [f'{stamp(c["start"])} --> {stamp(end)}',c['title'],c['description'],'']
    (folder/f'{key}-zh.vtt').write_text('\n'.join(cues),encoding='utf8')
    meta['chapters']=chapters
    (folder/f'{key}-metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
    return {'key':key,'duration':duration,'bytes':target.stat().st_size,'path':str(target)}
