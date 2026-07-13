#!/usr/bin/env bash
#
# Build standalone nanaban binaries for every supported platform using bun.
# Output goes to ./dist/. Each binary is fully self-contained — no Node runtime
# required — because `bun build --compile` embeds the bun interpreter alongside
# the bundled app code.
#
# Usage:
#   ./scripts/build-binaries.sh         # build everything
#   ./scripts/build-binaries.sh host    # build only the current host target
#
# Requires bun (https://bun.sh). Install with `curl -fsSL https://bun.sh/install | bash`.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required (https://bun.sh)" >&2
  exit 1
fi

# Keep VERSION in sync with src/version.ts — single source of truth.
VERSION=$(grep -oE "'[0-9]+\.[0-9]+\.[0-9]+'" src/version.ts | head -1 | tr -d "'")
ENTRY=src/cli.ts

mkdir -p dist

build_one() {
  local target=$1 out=$2
  echo "==> $out ($target)"
  bun build --compile --minify --sourcemap=none \
    --target="$target" \
    "$ENTRY" \
    --outfile "dist/$out"
}

if [[ "${1:-all}" == "host" ]]; then
  # Map host arch to a bun target for quick local iteration.
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  build_one bun-darwin-arm64  nanaban ;;
    Darwin-x86_64) build_one bun-darwin-x64    nanaban ;;
    Linux-x86_64)  build_one bun-linux-x64     nanaban ;;
    Linux-aarch64) build_one bun-linux-arm64   nanaban ;;
    *) echo "unsupported host"; exit 1 ;;
  esac
  exit 0
fi

build_one bun-darwin-arm64   "nanaban-darwin-arm64"
build_one bun-darwin-x64     "nanaban-darwin-x64"
build_one bun-linux-x64      "nanaban-linux-x64"
build_one bun-linux-arm64    "nanaban-linux-arm64"
build_one bun-windows-x64    "nanaban-windows-x64.exe"

echo
echo "==> sha256"
( cd dist && shasum -a 256 nanaban-* | tee SHA256SUMS.txt )

echo
echo "==> versions"
# Smoke-test the host binary only; cross-targets can't run here.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  ./dist/nanaban-darwin-arm64  --version ;;
  Darwin-x86_64) ./dist/nanaban-darwin-x64    --version ;;
  Linux-x86_64)  ./dist/nanaban-linux-x64     --version ;;
  Linux-aarch64) ./dist/nanaban-linux-arm64   --version ;;
esac

echo
echo "Built nanaban $VERSION. Artefacts in ./dist/"
