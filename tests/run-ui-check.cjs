'use strict';

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
