// Single source of truth for the CLI version.
// Kept in sync with package.json by scripts/bump-version.sh (or bun bump).
// Imported as a plain const so `bun build --compile` embeds it directly —
// reading package.json at runtime fails in compiled binaries because the
// embedded virtual FS (/$bunfs/...) does not include the project manifest.
export const VERSION = '4.2.1';
