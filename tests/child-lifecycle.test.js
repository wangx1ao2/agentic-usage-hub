'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const preload = path.join(__dirname, '..', 'lib', 'child-lifecycle.cjs');

test('a CLI child exits after its worker IPC owner disconnects, and IPC does not keep a completed CLI alive', async t => {
  for (const code of ['process.stdout.write("ready"); setInterval(()=>{},10000)', 'process.stdout.write("ready")']) {
    const child = spawn(process.execPath, ['--require', preload, '-e', code], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = '';
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('CLI lifecycle timed out')); }, 3000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    child.stdout.on('data', data => {
      output += data;
      if (code.includes('setInterval') && child.connected) child.disconnect();
    });
    assert.equal(await result, 0);
    assert.equal(output, 'ready');
  }
});
