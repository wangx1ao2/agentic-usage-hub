'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// Node 20 does not expand test globs; Windows shells also differ from POSIX.
const files = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js'))
  .sort().map(name => path.join(root, 'tests', name));
const child = spawn(process.execPath, ['--require', path.join(root, 'tests', 'fixture-environment.cjs'),
  '--test', '--test-concurrency=1', ...process.argv.slice(2), ...files],
{ cwd: root, stdio: 'inherit', windowsHide: true });
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
