'use strict';

// Locate installed browsers before HOME is replaced by the data-isolation
// fixture. Linux Playwright derives its browser cache from HOME/XDG_CACHE_HOME.
const path = require('node:path');
const os = require('node:os');
if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
      : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright');
}
require('./fixture-environment.cjs');
const { spawn } = require('node:child_process');
const { server } = require('../unified-server');
const service = require('../lib/usage-service');

server.listen(0, '127.0.0.1', () => {
  const motion = process.argv[2] === '--motion';
  const child = spawn(process.env.PYTHON || 'python', [motion ? 'tests/frontend-motion-check.py' : 'tests/frontend-ui-check.py',
    '--base-url', `http://127.0.0.1:${server.address().port}`, ...process.argv.slice(motion ? 3 : 2)], { stdio: 'inherit' });
  async function stop(code) {
    await service.dispose();
    server.close(() => { process.exitCode = code; });
  }
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => stop(code ?? 1));
});
