'use strict';

require('../lib/config');
const fs = require('node:fs');
const path = require('node:path');
const { configuredProjects, parseBusinessApiLog } = require('../lib/business-api-usage');
const sandbox = path.resolve(__dirname,'..','tmp','stable-upgrade');
const projects = configuredProjects();
const records = new Map();
let inspected = 0, withUsage = 0, parseErrors = 0, pendingLines = 0;
function files(directory, found = []) {
  if(found.length>=40)return found;
  let entries;
  try{entries=fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>b.name.localeCompare(a.name));}catch(_){return found;}
  for(const entry of entries){
    if(found.length>=40)break;
    if(/^(?:backups|.*tests|model-comparison)$/i.test(entry.name)||entry.isSymbolicLink())continue;
    const filename=path.join(directory,entry.name);
    if(entry.isDirectory())files(filename,found);
    else if(entry.isFile()&&(entry.name.endsWith('.log')||entry.name==='ai-usage.jsonl'))found.push(filename);
  }
  return found;
}
for(const project of projects){
  for(const filename of [...files(path.join(project,'.local')),...files(path.join(project,'logs'))]){
    const descriptor=fs.openSync(filename,'r');
    let text;
    try{
      const size=fs.fstatSync(descriptor).size, length=Math.min(size,2*1024*1024), offset=size-length;
      const buffer=Buffer.alloc(length);fs.readSync(descriptor,buffer,0,length,offset);text=buffer.toString('utf8');
      if(offset)text=text.slice(text.indexOf('\n')+1);
    }finally{fs.closeSync(descriptor);}
    const parsed=parseBusinessApiLog(text,filename,project);
    inspected++;if(parsed.records.length)withUsage++;
    parseErrors+=parsed.parseErrors;pendingLines+=parsed.pendingLines;
    for(const row of parsed.records)records.set(row.id,row);
  }
}
const rows=[...records.values()];
const report={auditDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),
  scope:'read-only tails of configured business logs; at most 2 MiB per file; no prompts, responses or original request IDs saved',
  configuredProjects:projects.length,inspectedFiles:inspected,filesWithUsage:withUsage,uniqueRequests:rows.length,
  tokenComponentsConserved:rows.every(row=>row.totalTokens===row.inputTokens+row.cacheReadTokens+row.outputTokens),
  unknownCosts:rows.filter(row=>row.unpriced).length,missingCacheDetails:rows.filter(row=>row.pricingContext?.cacheKnown===false).length,
  parseErrors,pendingLines,passed:rows.length>0&&parseErrors===0&&rows.every(row=>row.totalTokens===row.inputTokens+row.cacheReadTokens+row.outputTokens)};
fs.mkdirSync(sandbox,{recursive:true});fs.writeFileSync(path.join(sandbox,'business-api-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
