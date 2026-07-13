#!/usr/bin/env bash
#
# Single command to bump nanaban's version across every place it lives:
#   - package.json            (npm)
#   - src/version.ts          (runtime constant; embedded in bun binaries)
#   - Formula/nanaban.rb      (Homebrew formula template)
#
# The release workflow (.github/workflows/release.yml) double-checks these
# are in sync with the pushed tag and fails the build on any mismatch.
#
# Usage:
#   ./scripts/bump-version.sh 4.2.1

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <semver>" >&2
  exit 2
fi

NEW=$1
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be MAJOR.MINOR.PATCH (got '$NEW')" >&2
  exit 2
fi

# package.json — surgical sed on the "version" line only.
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  p.version = '$NEW';
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

# src/version.ts — the line is exactly: export const VERSION = '<x.y.z>';
node -e "
  const fs = require('fs');
  let t = fs.readFileSync('src/version.ts', 'utf8');
  t = t.replace(/export const VERSION = '[^']+';/, \"export const VERSION = '$NEW';\");
  fs.writeFileSync('src/version.ts', t);
"

# Formula/nanaban.rb — update the version declaration AND every /releases/download/vX.Y.Z/ URL.
node -e "
  const fs = require('fs');
  let t = fs.readFileSync('Formula/nanaban.rb', 'utf8');
  t = t.replace(/version \"[^\"]+\"/, 'version \"$NEW\"');
  t = t.replace(/\\/download\\/v[0-9]+\\.[0-9]+\\.[0-9]+\\//g, '/download/v$NEW/');
  fs.writeFileSync('Formula/nanaban.rb', t);
"

echo "Bumped to $NEW across:"
echo "  - package.json"
echo "  - src/version.ts"
echo "  - Formula/nanaban.rb"
echo
echo "Next:"
echo "  git commit -am \"bump: $NEW\""
echo "  git tag v$NEW"
echo "  git push && git push --tags        # triggers release.yml"
