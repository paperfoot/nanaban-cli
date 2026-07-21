import { VERSION } from '../version.js';

const LATEST_RELEASE_URL = 'https://api.github.com/repos/paperfoot/nanaban-cli/releases/latest';

export type InstallChannel = 'homebrew' | 'npm' | 'standalone';

// Framework rule: `update` is distribution-aware. Managed installs (brew, npm)
// must defer to the package manager — we detect the channel and return the
// exact tested upgrade command instead of self-replacing.
export function detectChannel(): InstallChannel {
  // Only compiled bun binaries can be homebrew/standalone installs. A
  // node-hosted process is ALWAYS the npm bin shim — checking execPath for
  // '/Cellar/' first misclassified every npm install running under a
  // homebrew-installed node (the common macOS setup) as 'homebrew'.
  if ((process as any).isBun || process.versions.bun) {
    const exec = process.execPath;
    if (exec.includes('/Cellar/') || exec.includes('/linuxbrew/')) return 'homebrew';
    return 'standalone';
  }
  return 'npm';
}

function upgradeCommand(channel: InstallChannel, latest: string): string {
  if (channel === 'homebrew') return 'brew update && brew upgrade paperfoot/tap/nanaban';
  if (channel === 'npm') return 'npm install -g nanaban@latest';
  if (process.platform === 'win32') {
    return `download nanaban-windows-x64.exe from https://github.com/paperfoot/nanaban-cli/releases/tag/v${latest} and replace ${process.execPath}`;
  }
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const url = `https://github.com/paperfoot/nanaban-cli/releases/download/v${latest}/nanaban-${platform}-${arch}`;
  // Download to a temp file and move atomically — never truncate the running
  // binary in place. SHA256SUMS.txt ships alongside every release.
  return `curl -fsSL -o /tmp/nanaban-${latest} ${url} && chmod +x /tmp/nanaban-${latest} && mv /tmp/nanaban-${latest} "${process.execPath}"`;
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
        hint: 'Retry, or check https://github.com/paperfoot/nanaban-cli/releases manually.',
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
    process.stderr.write(`nanaban ${VERSION} is up to date (latest: ${latest}).\n`);
    return;
  }
  process.stderr.write(`nanaban ${VERSION} → ${latest} available (install channel: ${channel}).\nRun:\n  ${command}\n`);
}
