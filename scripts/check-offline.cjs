'use strict';

// Called by the tarball check after installation, never a runtime dependency.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

function prepareOfflineFixture(sandbox,cli,install,pkg) {
  const home = path.join(sandbox,'offline-data');
  const project = path.join(home,'workspace');
  const env = {
    HOME:home,USERPROFILE:home,AGENTIC_CACHE_DIR:path.join(home,'cache'),
    AGENTIC_DISABLE_DOTENV:'1',HOST:'127.0.0.1',TZ:'Asia/Shanghai',
    CODEX_ACCOUNT_QUOTA_ENABLED:'',CODEX_ACCOUNT_QUOTA_DISABLED:'',
    CODEX_HOME:path.join(home,'.codex'),CLAUDE_CONFIG_DIR:path.join(home,'.claude'),
    CLAUDE_SESSIONS_DIR:path.join(home,'.claude','projects'),GROK_HOME:path.join(home,'.grok'),
    GROK_CONFIG_DIR:path.join(home,'.grok'),QWEN_SESSIONS_DIR:path.join(home,'.qwen','projects'),
    QWEN_USAGE_FILE:path.join(home,'.qwen','usage.jsonl'),QWEN_PRICING_REGION:'cn-beijing',
    QODER_SESSIONS_DIR:path.join(home,'.qoderworkcn','projects'),
    ZCODE_DB_PATH:path.join(home,'.zcode','db.sqlite'),
    ANTIGRAVITY_SESSIONS_DIR:path.join(home,'.gemini','brain'),
    ANTIGRAVITY_USAGE_BIN:path.join(home,'not-installed'),
    OPENCLAW_SESSIONS_DIR:path.join(home,'.openclaw','sessions'),REASONIX_USAGE_FILE:path.join(home,'.reasonix','usage.jsonl'),
    CODEX_IMAGE_DIR:path.join(home,'.codex','generated_images'),CODEX_IMAGE_DIRS:path.join(home,'.codex','generated_images'),
    BUSINESS_API_PROJECTS:project
  };
  const date = new Date(Date.now()-2*86400000).toISOString().slice(0,10);
  const timestamp = date+'T04:00:00Z';
  function write(filename,rows) {
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    fs.writeFileSync(filename,rows.map(JSON.stringify).join('\n')+'\n');
  }
  const usage = {input_tokens:1000,cached_input_tokens:800,output_tokens:100,reasoning_output_tokens:50,total_tokens:1100};
  const event = {type:'event_msg',timestamp,payload:{type:'token_count',info:{total_token_usage:usage,last_token_usage:usage}}};
  write(path.join(env.CODEX_HOME,'sessions','offline.jsonl'),[
    {type:'session_meta',timestamp,payload:{id:'offline-codex',cwd:project,source:'cli'}},
    {type:'turn_context',timestamp,payload:{model:'gpt-6.1-sol'}},event,event
  ]);
  write(path.join(env.CLAUDE_SESSIONS_DIR,'offline','session.jsonl'),[
    {type:'assistant',timestamp,sessionId:'offline-claude',requestId:'offline-request',cwd:project,
      message:{id:'msg_offline',type:'message',role:'assistant',model:'claude-sonnet-4-6',usage:{
        input_tokens:100,output_tokens:10,cache_read_input_tokens:50,cache_creation_input_tokens:25}}}
  ]);
  write(env.QWEN_USAGE_FILE,[{timestamp,id:'offline-qwen',model:'qwen3.8-flash',usage:{
    prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:20}}}]);
  write(path.join(project,'.local','ai-usage.jsonl'),[{timestamp,requestId:'offline-business',model:'gpt-6.1-terra',
    costUSD:0,usage:{prompt_tokens:50,completion_tokens:10,total_tokens:60,prompt_tokens_details:{cached_tokens:0}}}]);
  const config = path.join(home,'smoke-config.json');
  fs.writeFileSync(config,JSON.stringify({env,cli,install,pkg,fixtureDate:date,expectedTokens:1465,
    expectedSources:{codex:1100,claude:185,qwen:120,api:60}}));
  return config;
}

async function main(filename,isolated) {
  const settings = JSON.parse(fs.readFileSync(filename,'utf8'));
  Object.assign(process.env,settings.env);
  let network = 'not-isolated';
  if (isolated) {
    assert.equal(process.platform,'linux');
    execFileSync('ip',['link','set','dev','lo','up']);
    // Only network setup needs privilege. Run the package and native CLI as
    // the fixture owner so their generated directories remain removable by
    // the ordinary test runner after this process exits.
    const owner = fs.statSync(settings.env.HOME);
    if (process.getuid() === 0) { process.setgid(owner.gid); process.setuid(owner.uid); }
    const interfaces = Object.values(os.networkInterfaces()).flat().filter(Boolean);
    assert.ok(interfaces.length && interfaces.every(row=>row.internal),'Only loopback may be present in the network namespace');
    const networkError = await new Promise((resolve,reject)=>{
      const socket = net.connect({host:'1.1.1.1',port:443});
      socket.setTimeout(1500,()=>socket.destroy(new Error('External connection did not fail as unreachable')));
      socket.once('connect',()=>{socket.destroy();reject(new Error('External network unexpectedly reachable'));});
      socket.once('error',resolve);
    });
    assert.ok(['ENETUNREACH','EHOSTUNREACH','ENETDOWN'].includes(networkError.code),networkError.message);
    network = networkError.code;
  }
  const {exercisePackage} = require('./check-package.cjs');
  const result = await exercisePackage(settings.cli,settings.install,settings.pkg,settings);
  console.log(JSON.stringify({check:isolated ? 'installed-package-without-external-network' : 'installed-package-local-fixtures',network,
    totalTokens:settings.expectedTokens,sources:settings.expectedSources,...result}));
}

module.exports = {prepareOfflineFixture};
if (require.main === module) {
  assert.ok(['--run','--fixture-only'].includes(process.argv[2]));
  main(process.argv[3],process.argv[2]==='--run').catch(error=>{console.error(error);process.exitCode=1;});
}
