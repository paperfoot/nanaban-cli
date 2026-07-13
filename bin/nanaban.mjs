#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const cli = join(root, 'src', 'cli.ts');

try {
  execFileSync(tsx, [cli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
} catch (err) {
  // execFileSync throws on non-zero exit — propagate the exit code
  process.exit(err.status || 1);
}
