'use strict';

const path = require('node:path');
const os = require('node:os');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'ms-playwright') : process.platform === 'darwin'
    ? path.join(os.homedir(),'Library','Caches','ms-playwright')
    : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(),'.cache'),'ms-playwright');
require('../tests/fixture-environment.cjs');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {getLocalDateStr} = require('../lib/date');
process.env.CLAUDE_CONFIG_DIR = path.dirname(process.env.CLAUDE_SESSIONS_DIR);
process.env.GROK_HOME = path.join(process.env.HOME,'.grok');
const project = path.join(process.env.HOME,'demo-workspaces','shop-demo');
process.env.BUSINESS_API_PROJECTS = project;
const qwen = [], api = [];
function write(filename,rows) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,rows.map(JSON.stringify).join('\n')+'\n');
}
for (let ago=13; ago>=0; ago--) {
  const date = getLocalDateStr(new Date(Date.now()-ago*86400000));
  const start = Date.parse(date+'T00:00:00Z'), reset = (start+5*60*60*1000)/1000;
  const codex = [{type:'session_meta',timestamp:new Date(start).toISOString(),payload:{id:`demo-${date}`,cwd:'C:/demo/usage-hub',source:'cli'}},
    {type:'turn_context',payload:{model:'gpt-6.1-sol',service_tier:'default'}}];
  const claude = [];
  let total = {input_tokens:0,cached_input_tokens:0,output_tokens:0,reasoning_output_tokens:0,total_tokens:0};
  for (let i=0;i<8;i++) {
    const timestamp = new Date(start+i*15*60000).toISOString();
    const input = 30000+(ago%5)*6000+i*2000, output = 4000+(ago%3)*1000;
    const usage = {input_tokens:input,cached_input_tokens:Math.floor(input*.6),output_tokens:output,
      reasoning_output_tokens:Math.floor(output/2),total_tokens:input+output};
    total = Object.fromEntries(Object.keys(total).map(key=>[key,total[key]+usage[key]]));
    codex.push({type:'event_msg',timestamp,payload:{type:'token_count',info:{total_token_usage:total,last_token_usage:usage},
      rate_limits:{limit_id:'codex',plan_type:'plus',primary:{used_percent:i*8,resets_at:reset,window_minutes:300}}}});
    claude.push({type:'assistant',timestamp,sessionId:`demo-claude-${date}`,requestId:`demo-${date}-${i}`,cwd:'C:/demo/docs-site',
      message:{id:`msg_demo_${date}_${i}`,type:'message',role:'assistant',model:'claude-sonnet-5-5',usage:{
        input_tokens:12000+i*1000,cache_read_input_tokens:8000,output_tokens:1700,speed:'standard',inference_geo:'global'}}});
    qwen.push({timestamp,id:`qwen-${date}-${i}`,cwd:'C:/demo/qwen-tools',model:'qwen3.8-max',
      usageMetadata:{promptTokenCount:15000,cachedContentTokenCount:5000,candidatesTokenCount:1200,totalTokenCount:16200}});
    api.push({timestamp,requestId:`demo-api-${date}-${i}`,model:'gpt-6.1-terra',billingMode:'api',
      usage:{prompt_tokens:20000,completion_tokens:3000,total_tokens:23000,prompt_tokens_details:{cached_tokens:4000}}});
  }
  write(path.join(process.env.CODEX_HOME,'sessions',date+'.jsonl'),codex);
  write(path.join(process.env.CLAUDE_SESSIONS_DIR,'demo',date+'.jsonl'),claude);
}
write(process.env.QWEN_USAGE_FILE,qwen);
write(path.join(project,'.local','ai-usage.jsonl'),api);
const {server} = require('../unified-server');
const service = require('../lib/usage-service');
server.listen(0,'127.0.0.1',()=>{
  const child = spawn(process.env.PYTHON || 'python',[path.join(__dirname,'capture-previews.py'),
    `http://127.0.0.1:${server.address().port}`,path.resolve(process.argv[2] || path.join(__dirname,'..','docs','images'))],
    {stdio:'inherit',windowsHide:true});
  const stop = async code => {await service.dispose();server.close(()=>{process.exitCode=code;});};
  child.once('exit',code=>stop(code ?? 1));child.once('error',error=>{console.error(error.message);stop(1);});
});
