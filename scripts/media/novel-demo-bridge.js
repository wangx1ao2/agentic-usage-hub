// Browser-only fixtures for recording the existing Electron renderer.
// Nothing here reads the desktop database or calls a model provider.
(() => {
  const at = '2026-10-18T08:00:00Z';
  const original = '傍晚的潮水退去，林舟沿着旧码头向灯塔走去。海风吹动他的衣角，远处的灯亮了。他在台阶前停下，想起那封没有署名的信。';
  const revised = '暮色沉入海面，退潮后的旧码头露出斑驳的木桩。林舟迎着咸湿的风走向灯塔，衣角轻轻翻动。第一束灯光掠过他的肩头时，他停在石阶前，掌心仍攥着那封没有署名的信。';
  const tables = {
    novels: [{id:'demo-novel',title:'潮汐之后',description:'独立演示作品：一封匿名信与一座旧灯塔。',createdAt:at,updatedAt:at}],
    chapters: [{id:'demo-chapter',novelId:'demo-novel',title:'第一章 · 灯塔来信',content:JSON.stringify({type:'doc',content:[original,'岛上的人已经很久没有点亮灯塔了。林舟把信折好，推开了那扇生锈的门。'].map(text=>({type:'paragraph',content:[{type:'text',text}]}))}),wordCount:110,sortOrder:0,status:'draft',createdAt:at,updatedAt:at}],
    worlds: [{id:'demo-world',name:'回声岛',category:'地理环境',content:'一座依靠潮汐生活的小岛，旧灯塔位于北岸。',novelId:'demo-novel',createdAt:at,updatedAt:at}],
    characters: [{id:'demo-character',name:'林舟',role:'主角',description:'回到故乡调查匿名来信的青年。',personality:'谨慎、好奇，善于观察。',background:'少年时离开海岛。',appearance:'深色外套，随身携带笔记本。',abilities:'观察与记录。',relationships:'与岛上的守塔人相识。',novelId:'demo-novel',worldSettingId:'demo-world',createdAt:at,updatedAt:at}],
    prompts: [{id:'demo-prompt',name:'细节与氛围润色',category:'润色',systemPrompt:'演示模板',userPromptTemplate:'保留情节，补充场景细节：{{text}}',temperature:.7,maxTokens:800,createdAt:at,updatedAt:at}],
    apiConfigs: [{id:'demo-config',provider:'openai',apiKey:'',model:'本地演示接口',baseUrl:'http://127.0.0.1/demo',isActive:1,createdAt:at}]
  };
  const copy = value => structuredClone(value);
  const api = {};
  for (const [name, rows] of Object.entries(tables)) {
    api[name] = {
      list:async()=>copy(rows), get:async id=>copy(rows.find(row=>row.id===id)),
      create:async data=>{const row={id:`demo-${name}-${rows.length}`,createdAt:at,updatedAt:at,...data};rows.push(row);return copy(row);},
      update:async(id,data)=>{const row=rows.find(row=>row.id===id);if(!row)throw new Error('Unknown demo record');Object.assign(row,data);return copy(row);},
      delete:async id=>{const i=rows.findIndex(row=>row.id===id);if(i>=0)rows.splice(i,1);}
    };
  }
  api.chapters.listByNovel=async id=>copy(tables.chapters.filter(row=>row.novelId===id));
  api.chapters.updateContent=async(id,content,wordCount)=>api.chapters.update(id,{content,wordCount});
  let timer;
  api.ai={
    cancelStream:async()=>clearInterval(timer),testConnection:async()=> '本地模拟接口',getParagraphVersions:async()=>[],
    streamRewrite:(request,callbacks)=>{
      let offset=0;clearInterval(timer);
      timer=setInterval(()=>{
        callbacks.onChunk(revised.slice(offset,offset+7));offset+=7;
        if(offset>=revised.length){
          clearInterval(timer);
          const base={chapterId:request.chapterId,paragraphKey:request.paragraphKey,createdAt:at,promptId:request.promptId,provider:'local-demo',model:'preset'};
          callbacks.onDone({originalVersion:{...base,id:'original',versionNumber:1,source:'user',content:request.selectedText},aiVersion:{...base,id:'revised',versionNumber:2,source:'ai',content:revised}});
        }
      },160);
    }
  };
  window.api=api;
})();
