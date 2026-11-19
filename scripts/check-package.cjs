'use strict';

if (require.main === module) require('../tests/fixture-environment.cjs');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const root = path.resolve(__dirname, '..');
const sandbox = path.join(process.env.HOME, 'package-smoke');
fs.mkdirSync(sandbox, { recursive: true });
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
function npm(args, cwd) {
  return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false' }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
}
function launch(cli, args, cwd) {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: process.env, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] });
  child.errors = '';
  child.stderr.on('data', chunk => { child.errors += chunk; });
  child.completion = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return child;
}
async function stop(child) {
  child.kill();
  await child.completion;
}
async function waitForExit(child, ms = 5000) {
  let timer;
  try {
    return await Promise.race([child.completion, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Packaged process failed to exit: ' + child.errors)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function main() {
  const clean = path.join(sandbox, 'clean');
  fs.mkdirSync(clean);
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(root, name), path.join(clean, name));
  npm(['ci', '--no-audit', '--no-fund'], clean);
  const pkg = require('../package.json');
  assert.equal(require(path.join(clean, 'node_modules', 'ccusage', 'package.json')).version, pkg.dependencies.ccusage);
  const artifactIndex = process.argv.indexOf('--artifacts');
  if (artifactIndex >= 0) assert.ok(process.argv[artifactIndex+1],'--artifacts requires a destination directory');
  const packDestination = artifactIndex >= 0 ? path.resolve(process.argv[artifactIndex+1]) : sandbox;
  fs.mkdirSync(packDestination,{recursive:true});
  const [pack] = JSON.parse(npm(['pack', '--json', '--pack-destination', packDestination], root));
  const tarball = path.join(packDestination,pack.filename);
  assert.ok(pack.files.some(file => file.path === 'lib/index-worker.js'));
  assert.ok(pack.files.some(file => file.path === 'public/api.js'));
  assert.ok(!pack.files.some(file => /^(?:output|tmp|node_modules|\.cache)\//.test(file.path) || file.path === '.env'));
  const install = path.join(sandbox, 'installed');
  fs.mkdirSync(install);
  fs.writeFileSync(path.join(install, 'package.json'), JSON.stringify({ name: 'usage-hub-smoke', private: true }));
  npm(['install', '--no-audit', '--no-fund', tarball], install);
  const cli = path.join(install, 'node_modules', pkg.name, 'bin', 'agentic-usage-hub.js');
  // Follow the installed README's executable entry point through npm's bin
  // resolution as well as exercising the underlying Node CLI below.
  assert.match(npm(['exec','--offline','--','agentic-usage-hub','--version'],install),new RegExp(pkg.version.replaceAll('.', '\\.')));
  assert.match(npm(['exec','--offline','--','agentic-usage-hub','--help'],install),/--mcp/);
  const npxFirstRun = path.join(sandbox,'npx-first-run');
  fs.mkdirSync(npxFirstRun);
  assert.match(npm(['exec','--yes','--cache',path.join(sandbox,'npx-cache'),'--package',tarball,
    '--','agentic-usage-hub','--version'],npxFirstRun),new RegExp(pkg.version.replaceAll('.', '\\.')));
  const result = await exercisePackage(cli, install, pkg);
  const helper = path.join(__dirname,'check-offline.cjs');
  const config = require(helper).prepareOfflineFixture(sandbox,cli,install,pkg);
  const isolated = process.env.PACKAGE_OFFLINE_NAMESPACE === '1';
  let fixtureReport;
  if (isolated) {
    assert.equal(process.platform, 'linux', 'The network namespace check requires Linux');
    // Installs finish before the isolated network starts. The namespace applies
    // to Node, Workers and the actual native ccusage executable alike.
    fixtureReport = execFileSync('sudo',['-n','unshare','--net','--',process.execPath,helper,'--run',config],
      {encoding:'utf8',timeout:120_000,maxBuffer:4*1024*1024,windowsHide:true});
    result.offlineNetwork = 'isolated-namespace-passed';
  } else {
    fixtureReport = execFileSync(process.execPath,[helper,'--fixture-only',config],
      {encoding:'utf8',timeout:120_000,maxBuffer:4*1024*1024,windowsHide:true});
    result.offlineNetwork = 'not-isolated-local-fixtures-passed';
  }
  console.log(fixtureReport.trim());
  const report = {version:pkg.version,node:process.version,platform:process.platform,npmExec:'passed',npxFirstRun:'passed',
    cleanInstall:true,tarballFiles:pack.entryCount,tarballBytes:pack.size,...result};
  if (artifactIndex >= 0) {
    const sha256 = createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
    fs.writeFileSync(path.join(packDestination,'SHA256SUMS.txt'),`${sha256}  ${pack.filename}\n`);
    fs.writeFileSync(path.join(packDestination,'verification.json'),JSON.stringify({...report,
      sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
      verifiedAt:new Date().toISOString(),filename:pack.filename,sha256,integrity:pack.integrity,
      files:pack.files.map(file=>({path:file.path,size:file.size}))},null,2)+'\n');
  }
  console.log(JSON.stringify(report,null,2));
}

async function exercisePackage(cli, install, pkg, {expectedTokens=0,fixtureDate,expectedSources={}}={}) {
  assert.match(execFileSync(process.execPath, [cli, '--version'], { cwd: install, encoding: 'utf8' }), new RegExp(pkg.version.replaceAll('.', '\\.')));
  assert.match(execFileSync(process.execPath, [cli, '--help'], { cwd: install, encoding: 'utf8' }), /--port/);

  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const http = launch(cli, ['--port', String(port)], install);
  http.stdout.resume();
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(base + '/api/capabilities', { signal: AbortSignal.timeout(500) })).ok; } catch (_) {}
      if (ready) break;
      if (http.exitCode !== null) throw new Error(http.errors);
      await delay(100);
    }
    assert.ok(ready, 'Packaged CLI must listen on the requested port');
    for (const resource of ['/', '/app.js', '/api.js', '/chart.umd.js', '/styles.css']) {
      const response = await fetch(base + resource, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, resource);
      assert.ok((await response.text()).length);
    }
    let response, data;
    for (let i = 0; i < 40; i++) {
      response = await fetch(base + '/api/dashboard', { signal: AbortSignal.timeout(20_000) });
      data = await response.json();
      if (response.status !== 503) break;
      await delay(250);
    }
    assert.equal(response.status, 200, JSON.stringify({ data, stderr: http.errors }));
    assert.equal(data.totals.totalTokens, expectedTokens);
    for (const [source,total] of Object.entries(expectedSources)) assert.equal(data.agentBreakdown[source]?.totalTokens,total,source);
    assert.equal(data.meta.sources.codexAccount.networkAccess, 'disabled');
  } finally { await stop(http); }

  const mcp = launch(cli, ['--mcp'], install);
  let pending = '', sequence = 0;
  const waiting = new Map();
  mcp.stdout.setEncoding('utf8');
  mcp.stdout.on('data', chunk => {
    pending += chunk;
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, index); pending = pending.slice(index + 1);
      try {
        const row = JSON.parse(line);
        assert.equal(row.jsonrpc, '2.0', 'stdout is protocol-only');
        waiting.get(row.id)?.resolve(row); waiting.delete(row.id);
      } catch (error) { for (const item of waiting.values()) item.reject(error); }
    }
  });
  async function request(method, params) {
    const id = sequence++;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => { waiting.delete(id); reject(new Error(`MCP ${method} timed out: ${mcp.errors}`)); }, 20_000);
        waiting.set(id, { resolve, reject });
        mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    } finally { clearTimeout(timer); }
  }
  try {
    const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' } });
    assert.equal(initialized.result.protocolVersion, '2025-11-25');
    assert.equal(initialized.result.serverInfo.version, pkg.version);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.equal((await request('tools/list', {})).result.tools.length, 3);
    const today = await request('tools/call', { name: 'get_usage_today', arguments: {} });
    assert.equal(JSON.parse(today.result.content[0].text).totalTokens, 0);
    if (fixtureDate) {
      const range = await request('tools/call',{name:'get_usage_range',arguments:{startDate:fixtureDate,endDate:fixtureDate}});
      assert.equal(JSON.parse(range.result.content[0].text).totalTokens,expectedTokens,'Installed HTTP and MCP must agree offline');
    }
    assert.equal((await request('tools/call', { name: 'get_usage_range', arguments: { startDate: 'invalid' } })).error.code, -32602);
    mcp.stdin.end();
    assert.equal((await waitForExit(mcp)).code, 0, 'MCP EOF must stop background work');
  } finally { if (mcp.exitCode === null && mcp.signalCode === null) await stop(mcp); }
  return {http:'passed',mcp:'passed',mcpExit:'clean',quotaNetwork:'disabled'};
}
module.exports = {exercisePackage};
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
