#!/usr/bin/env node

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = join(__dirname, '..', 'src', 'cli.ts');

// Resolve tsx through module resolution, NOT a hardcoded nested
// node_modules/.bin path: hoisted layouts (npx, local dependency, pnpm) put
// the .bin shim in a parent tree, which made every such install exit 1 with
// zero output. Spawning node with the tsx ESM loader also works on Windows,
// where .bin shims are .cmd files that execFile cannot launch.
const require = createRequire(import.meta.url);
let loader;
try {
  loader = require.resolve('tsx/esm');
} catch {
  process.stderr.write('nanaban: cannot resolve the tsx runtime — the package install appears broken. Reinstall with: npm install -g nanaban\n');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'file://' + loader.replace(/\\/g, '/'), cli, ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: process.cwd(), env: process.env },
);

if (result.error) {
  process.stderr.write(`nanaban: failed to start: ${result.error.message}\n`);
  process.exit(2);
}
if (result.signal) {
  // Shell convention: killed by signal N exits 128+N.
  const signals = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
  process.exit(128 + (signals[result.signal] ?? 15));
}
process.exit(result.status ?? 1);
