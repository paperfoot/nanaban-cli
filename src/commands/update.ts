import { VERSION } from '../version.js';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/paperfoot/slika/releases/latest';

export type InstallChannel = 'homebrew' | 'npm' | 'standalone';

// Framework rule: `update` is distribution-aware. Managed installs (brew, npm)
// must defer to the package manager — we detect the channel and return the
// exact tested upgrade command instead of self-replacing.
export function detectChannel(): InstallChannel {
  const exec = process.execPath;
  if (exec.includes('/Cellar/') || exec.includes('/linuxbrew/')) return 'homebrew';
  // Compiled bun binaries run from the embedded interpreter; a node-hosted
  // process means we were launched through the npm bin shim.
  if (!(process as any).isBun && !process.versions.bun) return 'npm';
  return 'standalone';
}

function upgradeCommand(channel: InstallChannel, latest: string): string {
  if (channel === 'homebrew') return 'brew update && brew upgrade paperfoot/tap/slika';
  if (channel === 'npm') return 'npm install -g slika@latest';
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const ext = platform === 'windows' ? '.exe' : '';
  return `curl -fsSL -o "${process.execPath}" https://github.com/paperfoot/slika/releases/download/v${latest}/slika-${platform}-${arch}${ext} && chmod +x "${process.execPath}"`;
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export async function runUpdate(json: boolean): Promise<void> {
  const channel = detectChannel();

  let latest: string;
  try {
    const res = await fetch(LATEST_RELEASE_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
    const body = await res.json() as { tag_name?: string };
    if (!body.tag_name) throw new Error('release has no tag_name');
    latest = body.tag_name.replace(/^v/, '');
  } catch (err: any) {
    if (json) {
      process.stdout.write(JSON.stringify({
        status: 'error',
        code: 'NETWORK_ERROR',
        message: `Could not check latest release: ${err.message}`,
        hint: 'Retry, or check https://github.com/paperfoot/slika/releases manually.',
      }) + '\n');
    } else {
      process.stderr.write(`Error: could not check latest release: ${err.message}\n`);
    }
    process.exit(1);
  }

  const updateAvailable = cmpSemver(latest!, VERSION) > 0;
  const command = upgradeCommand(channel, latest!);

  if (json) {
    process.stdout.write(JSON.stringify({
      status: 'success',
      current: VERSION,
      latest,
      update_available: updateAvailable,
      channel,
      command: updateAvailable ? command : undefined,
    }) + '\n');
    return;
  }

  if (!updateAvailable) {
    process.stderr.write(`slika ${VERSION} is up to date (latest: ${latest}).\n`);
    return;
  }
  process.stderr.write(`slika ${VERSION} → ${latest} available (install channel: ${channel}).\nRun:\n  ${command}\n`);
}
