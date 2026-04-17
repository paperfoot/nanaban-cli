# Contributing to nanaban

Thanks for your interest in contributing. Here is how to get started.

## Setup

```bash
git clone https://github.com/paperfoot/nanaban-cli.git
cd nanaban
npm install
npm link
```

You need a Gemini API key to test image generation. Get one free at [Google AI Studio](https://aistudio.google.com/apikey).

## Project Structure

```
src/
  cli.ts          # CLI entry point and argument parsing
  commands/       # Command implementations (generate, edit, auth)
  core/           # Image generation engine (client, generate, reference)
  lib/            # Utilities (config, errors, naming, output)
bin/
  nanaban.mjs     # npm bin entry point
```

## Making Changes

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Test your changes locally with `nanaban "test prompt"`.
4. Keep commits focused and write clear commit messages.
5. Open a pull request against `main`.

## Guidelines

- Keep the dependency count low. Every new dependency needs a strong reason.
- Ship TypeScript source directly. No build step.
- stdout is reserved for the file path. All other output goes to stderr.
- `--json` output must remain backward-compatible.
- Auto-naming logic should stay deterministic and predictable.

## Reporting Bugs

Open an issue at [github.com/paperfoot/nanaban-cli/issues](https://github.com/paperfoot/nanaban-cli/issues). Include your Node version, OS, and the command you ran.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
