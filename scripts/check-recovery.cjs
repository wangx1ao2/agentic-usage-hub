'use strict';

// A manual cross-version rehearsal using the preserved pre-upgrade checkpoint.
// All data lives under the normal isolated test HOME; no personal cache is read.
require('../tests/fixture-environment.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const sandbox = path.join(process.env.HOME,'recovery-rehearsal');
fs.mkdirSync(sandbox,{recursive:true});
const checkedPath = (...parts) => {
  const filename = path.resolve(...parts), relative = path.relative(sandbox,filename);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Recovery path must stay inside the fixture sandbox');
  return filename;
};
const digest = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function manifest(directory) {
  const result = {};
  for (const name of fs.readdirSync(directory,{recursive:true})) {
    const filename = path.join(directory,name);
    if (fs.statSync(filename).isFile()) result[name] = digest(filename);
  }
  return result;
}

async function main() {
  const baseline = execFileSync('git',['rev-parse','--verify','--end-of-options',process.argv[2] || '4c2b3c9'],
    {cwd:root,encoding:'utf8'}).trim();
  assert.match(baseline,/^[a-f0-9]{40}$/);
  const oldRoot = checkedPath(sandbox,'baseline'), archive = checkedPath(sandbox,'baseline.tar');
  fs.mkdirSync(oldRoot);
  execFileSync('git',['archive','--format=tar','--output',archive,baseline],{cwd:root});
  execFileSync('tar',['-xf',archive,'-C',oldRoot]);
  const old = name => require(path.join(oldRoot,'lib',name));
  const current = name => require(path.join(root,'lib',name));
  const cache = checkedPath(sandbox,'cache'), backup = checkedPath(sandbox,'pre-upgrade-backup');
  const project = checkedPath(sandbox,'workspace'), logs = checkedPath(project,'.local','ai-usage.jsonl');
  fs.mkdirSync(path.dirname(logs),{recursive:true});
  const timestamp = '2026-11-17T04:00:00Z';
  const raw = [
    {requestId:'reported-request',model:'gpt-6.1-terra',timestamp,costUSD:0.031,
      usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}},
    {requestId:'review-request',model:'codex-auto-review',timestamp,
      usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}
  ];
  fs.writeFileSync(logs,raw.map(JSON.stringify).join('\n')+'\n');
  const businessOptions = {projects:()=>[project],ledgerDir:checkedPath(cache,'business-api')};
  const originalBusiness = old('business-api-usage').createBusinessApiMonitor(businessOptions).getRecords(true);
  assert.equal(originalBusiness.length,2);

  const sourceFile = checkedPath(sandbox,'qwen.jsonl');
  fs.writeFileSync(sourceFile,JSON.stringify({id:'qwen-request',timestamp,cwd:project,model:'qwen3-max',
    usageMetadata:{promptTokenCount:100,cachedContentTokenCount:10,candidatesTokenCount:20,totalTokenCount:120}})+'\n');
  const sourceHash = digest(sourceFile);
  const indexFile = checkedPath(cache,'indexes','qwen.json');
  const oldIdentity = old('persistent-cache').getRuntimeIdentity();
  const oldIndex = old('file-cache').createFileCache((content,filename)=>old('log-parsers').parseUsageLog('qwen',content,filename),
    fs,{filename:indexFile,identity:oldIdentity});
  const originalQwen = oldIndex.update([sourceFile]);
  assert.equal(originalQwen.length,1);
  const historyOptions = {directory:checkedPath(cache,'pricing')};
  const originalRecords = [...originalBusiness,...originalQwen];
  const oldHistory = old('pricing-history').createPricingHistory(historyOptions);
  const captured = oldHistory.apply(originalRecords);
  assert.ok(captured.every(row=>row.costUSD !== null));
  const oldVersion = oldHistory.metadata().currentVersion;
  const quotaFile = checkedPath(cache,'codex-quota','history.jsonl');
  const reset = Date.parse('2026-11-17T09:00:00Z');
  const originalQuota = old('codex-account-quota').createAccountQuotaMonitor({filename:quotaFile,
    enabled:()=>true,now:()=>Date.parse(timestamp),read:async()=>({rateLimits:{limitId:'codex',planType:'plus',
      primary:{usedPercent:86,resetsAt:reset/1000,windowDurationMins:300}}})});
  await originalQuota.capture(true);
  originalQuota.confirmWindow({resetsAt:reset,usedPercent:100,note:'Synthetic recovery fixture'});
  const originalSnapshots = originalQuota.getSnapshots();
  await originalQuota.dispose();
  assert.equal(originalSnapshots.length,2);

  // Simulate log rotation before upgrading: the old business observations now
  // exist only in the durable ledger and cannot be rebuilt from the empty log.
  fs.writeFileSync(logs,'');
  fs.cpSync(cache,backup,{recursive:true});
  const backupManifest = manifest(backup);
  process.env.CODEX_AUTO_REVIEW_RATE_MODEL = '';
  const upgradedBusiness = current('business-api-usage').createBusinessApiMonitor(businessOptions).getRecords(true);
  assert.deepEqual(upgradedBusiness.map(row=>row.id),originalBusiness.map(row=>row.id));
  assert.deepEqual(upgradedBusiness.map(row=>row.totalTokens),originalBusiness.map(row=>row.totalTokens));
  const newIdentity = current('persistent-cache').getRuntimeIdentity();
  assert.notEqual(newIdentity,oldIdentity);
  const rebuiltIndex = current('file-cache').createFileCache((content,filename)=>current('log-parsers').parseUsageLog('qwen',content,filename),
    fs,{filename:indexFile,identity:newIdentity});
  const upgradedQwen = rebuiltIndex.update([sourceFile]);
  assert.equal(rebuiltIndex.diagnostics().restoredFiles,0);
  assert.equal(rebuiltIndex.diagnostics().parsedFiles,1);
  assert.equal(upgradedQwen[0].costUSD,null,'The removed current Qwen reference stays unknown before captured history is applied');
  const newHistory = current('pricing-history').createPricingHistory(historyOptions);
  const restored = newHistory.apply([...upgradedBusiness,...upgradedQwen]);
  assert.deepEqual(restored.map(row=>row.costUSD),captured.map(row=>row.costUSD));
  assert.deepEqual(restored.map(row=>row.totalTokens),captured.map(row=>row.totalTokens));
  assert.equal(newHistory.apply(upgradedQwen,{pricingMode:'current'})[0].costUSD,null);
  assert.equal(newHistory.apply(upgradedQwen,{pricingMode:'current',pricingVersion:oldVersion})[0].costUSD,originalQwen[0].costUSD);
  assert.deepEqual(current('codex-account-quota').createAccountQuotaMonitor({filename:quotaFile,enabled:()=>false}).getSnapshots(),originalSnapshots);
  assert.equal(digest(sourceFile),sourceHash);
  assert.equal(fs.readFileSync(logs,'utf8'),'');
  assert.deepEqual(manifest(backup),backupManifest,'The immutable backup must not change');

  // New nullable rates need not be readable by old software. It must retain
  // that file on failure; rollback therefore restores the actual old backup.
  const upgradedHistoryHash = digest(path.join(cache,'pricing','history.json'));
  const incompatible = old('pricing-history').createPricingHistory(historyOptions);
  assert.equal(incompatible.metadata().readable,false);
  incompatible.apply(originalRecords);
  assert.equal(digest(path.join(cache,'pricing','history.json')),upgradedHistoryHash);
  const postUpgrade = checkedPath(sandbox,'post-upgrade-preserved');
  fs.renameSync(checkedPath(cache),postUpgrade);
  fs.cpSync(backup,checkedPath(cache),{recursive:true});
  assert.deepEqual(manifest(cache),backupManifest);
  const rolledBack = old('pricing-history').createPricingHistory(historyOptions);
  assert.equal(rolledBack.metadata().readable,true);
  assert.deepEqual(rolledBack.apply(originalRecords).map(row=>row.costUSD),captured.map(row=>row.costUSD));
  assert.deepEqual(old('codex-account-quota').createAccountQuotaMonitor({filename:quotaFile,enabled:()=>false}).getSnapshots(),originalSnapshots);
  assert.equal(old('business-api-usage').createBusinessApiMonitor(businessOptions).getRecords(true).length,2);
  assert.equal(digest(sourceFile),sourceHash);
  console.log(JSON.stringify({baseline,current:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    upgrade:'passed',rollback:'passed',rotatedBusinessRequests:2,quotaObservations:2,
    capturedAmounts:'preserved',oldCatalogReplay:'passed',derivedIndex:'rebuilt',
    incompatibleHistory:'preserved',backup:'byte-identical',sourceLogs:'unchanged'},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
