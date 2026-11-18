'use strict';

// A worker can be terminated while its CLI child is doing asynchronous I/O.
// Closing the worker's IPC channel also stops the child; no PID-based guessing
// or killing an unrelated process after PID reuse is needed.
if (process.channel) {
  process.on('disconnect', () => process.exit(0));
  process.channel.unref();
}
