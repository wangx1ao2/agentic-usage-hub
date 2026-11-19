'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL_CATALOG, quoteModelUsage } = require('../models-pricing');
const { createPricingHistory } = require('../lib/pricing-history');
const { createRequestRecord } = require('../lib/request-record');
const { parseUsageLog } = require('../lib/log-parsers');
const { parseRecords, applyRequestPricing, priceRequest } = require('../lib/codex-request-usage');
const { getCcusageBreakdownCost } = require('../lib/ccusage-normalize');

const options = { source:'api',granularity:'request',asOf:'2026-11-19T04:00:00Z' };
const quote = (model, fresh, cached, output = 1000, extra = {}) => quoteModelUsage(model,
  { inputTokens:fresh,cacheReadTokens:cached,outputTokens:output }, { ...options,...extra });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('verified request boundaries include cache reads and differ from a daily aggregate', () => {
  close(quote('gpt-5.4',72000,200000).cost, 0.245);
  close(quote('gpt-5.4',72001,200000).cost, 0.482505);
  assert.equal(quote('gpt-5.4',72001,200000).longContext, true);
  const daily = quote('gpt-5.4',72001,200000,1000,{granularity:'day-model'});
  close(daily.cost,0.2450025);
  assert.equal(daily.longContext,false);
  assert.equal(daily.costComplete,false);
  assert.ok(daily.issues.includes('request-context-unavailable'));
  assert.equal(quote('grok-4.7',99999,100000).longContext,false);
  assert.equal(quote('grok-4.7',100000,100000).longContext,true);
  close(quote('grok-4.7',100000,100000).cost,0.512);
  assert.equal(quote('claude-haiku-5-5',10000,90000).longContext,false);
  close(quote('claude-haiku-5-5',10001,90000).cost,0.0120005);
});

test('Gemini corrected rates, long prompt band and batch cache prices are independent', () => {
  close(quote('gemini-2.5-flash',100000,100000,10000).cost,0.058);
  close(quote('gemini-2.5-pro',100000,100000,10000).cost,0.2375);
  close(quote('gemini-2.5-pro',100001,100000,10000).cost,0.4250025);
  close(quote('gemini-2.5-pro',100000,100000,10000,{serviceTier:'batch'}).cost,0.125);
  close(quote('gemini-2.5-pro',100001,100000,10000,{serviceTier:'flex'}).cost,0.22500125);
  close(quote('gemini-2.5-flash',100000,100000,10000,{serviceTier:'batch'}).cost,0.0305);
});

test('service tiers never borrow another model or vendor multiplier', () => {
  assert.equal(quote('gpt-6.1-terra',100,0,10,{serviceTier:'ultrafast'}).cost,null);
  assert.equal(quote('grok-4.7',100,0,10,{serviceTier:'fast'}).cost,null);
  assert.equal(quote('gpt-6.1-sol',100,0,10,{serviceTier:'invented'}).costComplete,false);
  close(quote('gpt-6.1-sol',100000,100000,10000,{serviceTier:'ultrafast'}).cost,1.86);
});

test('Claude cache write TTL split completes a quote and participates in its prompt threshold', () => {
  const usage = { inputTokens:10000,cacheReadTokens:80000,cacheWriteTokens:10001,outputTokens:1000 };
  const split = { shortTokens:10000,longTokens:1 };
  const complete = quoteModelUsage('claude-haiku-5-5',usage,{...options,cacheWrite:split});
  close(complete.cost,0.017751);
  assert.equal(complete.longContext,true);
  assert.equal(complete.costComplete,true);
  for (const cacheWrite of [undefined,{shortTokens:10000,longTokens:0}]) {
    const incomplete = quoteModelUsage('claude-haiku-5-5',usage,{...options,cacheWrite});
    assert.equal(incomplete.costComplete,false);
    assert.ok(incomplete.issues.includes('cache-write-rate-unavailable'));
  }
  const lines = [{ timestamp:'2026-11-19T04:00:00Z',requestId:'r',message:{id:'msg_x',model:'claude-haiku-5-5',usage:{
    input_tokens:10000,cache_read_input_tokens:80000,
    cache_creation:{ephemeral_5m_input_tokens:10000,ephemeral_1h_input_tokens:1},output_tokens:1000
  }}}].map(JSON.stringify).join('\n') + '\n';
  const record = parseUsageLog('claude',lines,'fixture.jsonl').records[0];
  assert.equal(record.totalTokens,101001);
  assert.equal(record.costUSD,0.017751);
  assert.equal(record.costComplete,true);
  assert.deepEqual(record.pricingContext.cacheWrite,split);
});

test('a reference expiry affects current quotes while recorded and explicit snapshot replay survive restart', () => {
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'pricing-expiry-'));
  const catalog = { 'gemini-2.5-pro':MODEL_CATALOG['gemini-2.5-pro'] };
  const record = { ...createRequestRecord({source:'antigravity',id:'expires',model:'gemini-2.5-pro',
    timestamp:'2026-11-19T04:00:00Z',inputTokens:100000,outputTokens:10000}),
    costUSD:0.225,unpriced:false,costComplete:true,costBasis:'catalog-estimate' };
  const first = createPricingHistory({directory,catalog,now:()=>'2026-11-19T04:00:00Z'});
  const original = first.apply([record])[0];
  const restarted = createPricingHistory({directory,catalog,now:()=>'2026-12-01T04:00:00Z'});
  const expiredRecord = {...record,costUSD:null,unpriced:true,costBasis:'unpriced',costComplete:false};
  assert.equal(restarted.apply([expiredRecord])[0].costUSD,original.costUSD);
  assert.equal(restarted.apply([record],{pricingMode:'current'})[0].costUSD,null);
  const replay = restarted.apply([record],{pricingMode:'current',pricingVersion:original.pricingVersion})[0];
  assert.equal(replay.costUSD,original.costUSD);
  assert.equal(replay.costComplete,true);
});

test('saved catalogs include rules and evidence; old snapshots retain their arithmetic', () => {
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'pricing-policy-'));
  const legacy = { 'gpt-5.4': { standard:{in:2.5,cache:0.25,out:15} } };
  const record = { ...createRequestRecord({source:'codex',id:'long',model:'gpt-5.4',
    timestamp:'2026-11-19T04:00:00Z',inputTokens:300000,outputTokens:10000}), costUSD:0.9,
    pricingContext:{serviceTier:'fast'} };
  const old = createPricingHistory({directory,catalog:legacy});
  const first = old.apply([record])[0];
  const upgraded = createPricingHistory({directory,catalog:{'gpt-5.4':MODEL_CATALOG['gpt-5.4']}});
  const current = upgraded.apply([record],{pricingMode:'current'})[0];
  assert.notEqual(current.pricingVersion,first.pricingVersion);
  assert.equal(current.costUSD,3.45);
  assert.equal(upgraded.apply([record],{pricingMode:'current',pricingVersion:first.pricingVersion})[0].costUSD,1.8);
  assert.equal(upgraded.apply([record])[0].costUSD,0.9);
  const saved = JSON.parse(fs.readFileSync(path.join(directory,'history.json'),'utf8'));
  assert.equal(saved.snapshots[current.pricingVersion].rates['gpt-5.4'].pricingPolicy.context.above,272000);
  assert.equal(saved.snapshots[current.pricingVersion].rates['gpt-5.4'].pricingEvidence.checkedAt,'2026-11-19');
  assert.equal(saved.snapshots[first.pricingVersion].rates['gpt-5.4'].pricingPolicy,undefined);
  const {quoteCatalogUsage} = require('../lib/pricing-rules');
  const legacyGpt6 = {standard:{in:2,cache:0.1,out:10}};
  const legacyWrite = quoteCatalogUsage(legacyGpt6,'gpt-6.1-sol',{
    inputTokens:272000,cacheReadTokens:0,cacheWriteTokens:10,outputTokens:1000 },{source:'codex'});
  assert.equal(legacyWrite.longContext,false,'Old snapshots did not use cache writes in the threshold');
  assert.equal(legacyWrite.cost,0.554);
});

test('an exactly matching request snapshot corrects a nonzero native short-context estimate', () => {
  const usage = {input_tokens:300000,cached_input_tokens:100000,output_tokens:10000,total_tokens:310000};
  const records = [{type:'turn_context',payload:{model:'gpt-5.4'}},
    {type:'event_msg',timestamp:'2026-11-19T04:00:00Z',payload:{type:'token_count',info:{last_token_usage:usage,total_token_usage:usage}}}];
  const parsed = parseRecords(records);
  const row = {agent:'codex',modelName:'gpt-5.4',inputTokens:200000,cacheReadTokens:100000,outputTokens:10000,cost:0.675};
  applyRequestPricing({daily:[{date:parsed.events[0].date,modelBreakdowns:[row]}]},[parsed]);
  close(getCcusageBreakdownCost(row.modelName,row).cost,1.275);
  assert.equal(row.requestPricing.longContextRequests,1);
  assert.equal(priceRequest('gpt-6.1-terra',usage,'ultrafast').unpriced,true);
});

test('a hosted model without provider pricing keeps tokens and reported zero without claiming free usage', () => {
  const input = {source:'openclaw',id:'hosted',model:'llama-3.3-70b',timestamp:'2026-11-19T04:00:00Z',inputTokens:1000};
  const unknown = createRequestRecord(input);
  assert.equal(unknown.costUSD,null);
  assert.equal(unknown.totalTokens,1000);
  assert.equal(unknown.pricingContext.evidence.status,'provider-required');
  const reported = createRequestRecord({...input,id:'reported',costUSD:0});
  assert.equal(reported.costUSD,0);
  assert.equal(reported.costComplete,true);
  assert.equal(reported.costBasis,'reported');
});

test('corrupt policy metadata is preserved as an unreadable history instead of executing malformed rules', () => {
  const directory = fs.mkdtempSync(path.join(process.env.HOME,'pricing-corrupt-policy-'));
  const history = createPricingHistory({directory,catalog:{'gpt-5.4':MODEL_CATALOG['gpt-5.4']}});
  history.persist();
  const filename = path.join(directory,'history.json');
  const saved = JSON.parse(fs.readFileSync(filename,'utf8'));
  const snapshot = Object.values(saved.snapshots)[0];
  snapshot.rates['gpt-5.4'].pricingPolicy.serviceTiers.fast = {input:'bad'};
  snapshot.id = 'catalog-' + require('node:crypto').createHash('sha256').update(JSON.stringify(snapshot.rates)).digest('hex').slice(0,24);
  saved.snapshots = {[snapshot.id]:snapshot};
  const malformed = JSON.stringify(saved);
  fs.writeFileSync(filename,malformed);
  const restarted = createPricingHistory({directory});
  assert.equal(restarted.metadata().readable,false);
  restarted.persist();
  assert.equal(fs.readFileSync(filename,'utf8'),malformed);
});
