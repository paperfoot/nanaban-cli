<p align="center">
  <img src="nanaban_logo.png" alt="nanaban — image generation from the terminal" width="600">
</p>

<h1 align="center">nanaban</h1>

<p align="center">
  Image generation from the terminal. <strong>GPT Image 2 free on your ChatGPT Plus/Pro subscription</strong> — no OpenAI API key, no metered billing. Plus Nano Banana (Gemini) and GPT-5 Image. One CLI.
</p>

<p align="center">
  <a href="https://github.com/paperfoot/nanaban-cli/stargazers"><img src="https://img.shields.io/github/stars/paperfoot/nanaban?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow" alt="Star this repo"></a>
  &nbsp;
  <a href="https://x.com/longevityboris"><img src="https://img.shields.io/badge/Follow_%40longevityboris-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow @longevityboris on X"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/nanaban"><img src="https://img.shields.io/npm/v/nanaban?style=for-the-badge&logo=npm&logoColor=white&label=npm&color=CB3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/nanaban"><img src="https://img.shields.io/npm/dm/nanaban?style=for-the-badge&logo=npm&logoColor=white&color=CB3837" alt="npm downloads"></a>
  <a href="https://github.com/paperfoot/nanaban-cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/nanaban?style=for-the-badge&logo=node.js&logoColor=white&color=339933" alt="Node.js version"></a>
</p>

<p align="center">
  Type a prompt. Get an image. One command, zero browser tabs. nanaban is a CLI for AI image generation that works for humans typing prompts and LLM agents calling <code>--json</code>. It runs OpenAI's GPT Image 2 (free against your ChatGPT Plus/Pro subscription via Codex OAuth), Google's Nano Banana (Gemini), and OpenAI GPT-5 Image — pick whichever, or let nanaban choose based on the auth you have.
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#quick-start">Quick Start</a> · <a href="#models">Models</a> · <a href="#auth">Auth</a> · <a href="#usage">Usage</a> · <a href="#for-llm-agents-and-scripts">Agent Mode</a> · <a href="#contributing">Contributing</a>
</p>

---

## What It Looks Like

<table>
<tr>
<td align="center">
<img src="examples/cyberpunk_tokyo.png" width="350"><br>
<code>nanaban "cyberpunk tokyo street neon rain" --ar wide</code>
</td>
<td align="center">
<img src="examples/fox_ink.png" width="250"><br>
<code>nanaban "minimalist single line fox"</code>
</td>
<td align="center">
<img src="examples/product_mug.png" width="250"><br>
<code>nanaban "product photo white ceramic mug"</code>
</td>
</tr>
</table>

Every image on this page was generated with nanaban. Straight from the terminal.

## Why This Exists

Most AI image generators make you open a browser, wait in a queue, click through UI, and download manually. That workflow breaks the second you need images inside a script, a CI pipeline, or an agent loop.

nanaban fixes that:

- **One command** — type your prompt, get a file. No browser, no signup flow, no queue.
- **Free GPT Image 2** for ChatGPT Plus/Pro subscribers. nanaban reads the OAuth token written by `codex login` and hits the private Codex backend (`chatgpt.com/backend-api/codex/responses`) on your behalf — every generation decrements your ChatGPT image quota, **not** your OpenAI API balance. Zero marginal cost, no API key needed.
- **Three model families, one CLI** — GPT Image 2 (OpenAI's April 2026 flagship) when Codex auth is present, Nano Banana (Gemini) for the cheap/fast default with extended ratios, GPT-5 Image for OpenAI's text/UI work via OpenRouter.
- **Auto-names files** — `"a fox in a snowy forest at dawn"` becomes `fox_snowy_forest_dawn.png`.
- **Built for scripts** — stdout is always the file path. `nanaban "a cat" | xargs open` just works.
- **Built for LLM agents** — `--json` gives structured output with cost. `nanaban agent-info` is a machine-readable manifest of every model, flag, transport, and error code (with per-code recovery instructions).
- **Tiny footprint** — one Node package, or one standalone binary with no runtime required.

## Install

Three options, pick whichever matches how you like to install CLIs:

**Homebrew** (macOS/Linux, no Node needed):

```bash
brew install paperfoot/tap/nanaban
```

**Standalone binary** (no Node needed, pick your platform):

```bash
# macOS (Apple Silicon)
curl -L https://github.com/paperfoot/nanaban-cli/releases/latest/download/nanaban-darwin-arm64 -o /usr/local/bin/nanaban && chmod +x /usr/local/bin/nanaban

# macOS (Intel)
curl -L https://github.com/paperfoot/nanaban-cli/releases/latest/download/nanaban-darwin-x64 -o /usr/local/bin/nanaban && chmod +x /usr/local/bin/nanaban

# Linux (x86_64)
curl -L https://github.com/paperfoot/nanaban-cli/releases/latest/download/nanaban-linux-x64 -o /usr/local/bin/nanaban && chmod +x /usr/local/bin/nanaban

# Linux (arm64)
curl -L https://github.com/paperfoot/nanaban-cli/releases/latest/download/nanaban-linux-arm64 -o /usr/local/bin/nanaban && chmod +x /usr/local/bin/nanaban
```

**npm** (if you already have Node 20+):

```bash
npm install -g nanaban
```

**From source:**

```bash
git clone https://github.com/paperfoot/nanaban-cli.git
cd nanaban && npm install && npm link
```

## Quick Start

Three paths. Pick the one you already have credentials for:

**Free via ChatGPT Plus/Pro** (recommended if you have a sub):

```bash
# One-time: log in with your ChatGPT account
codex login
# Then just:
nanaban "a fox in snow"          # uses GPT Image 2, billed to your ChatGPT sub ($0)
```

**OpenRouter** (one key for Nano Banana AND GPT-5 Image):

```bash
# Get a key from https://openrouter.ai/keys
export OPENROUTER_API_KEY=sk-or-v1-...
nanaban "a fox in snow"                    # uses Nano Banana 2
nanaban "a fox in snow" --model lite       # uses Nano Banana 2 Lite
```

**Gemini direct** (free tier available):

```bash
# Get a key from https://aistudio.google.com/apikey
nanaban auth set AIzaSy...
nanaban "a fox in snow"
```

You only need **one** path configured. nanaban detects what's available and routes automatically. Run `nanaban auth` to see what's reachable. With no `--model`, the requested size, aspect, and quality select the route — a plain request uses the free Codex path, and `--size 2k/4k` moves to a provider that can actually deliver it.

## Models

| Id | Family | Best for | Max resolution | ~Cost/img |
|----|--------|----------|----------------|-----------|
| `gpt-image-2` | OpenAI GPT Image 2 | Strong text, high fidelity, PNG output | ~1.57 MP free via Codex; 2K metered | **$0** on ChatGPT Plus/Pro |
| `nb2` | Gemini Nano Banana 2 | The workhorse — fast, cheap, true 4K | 4K (5504×3072 at 16:9) | $0.067 |
| `nb-lite` | Gemini Nano Banana 2 Lite | Fastest + cheapest, high-volume drafts (~3s/image) | 1K | $0.034 |

All models accept the ten standard aspect ratios (`1:1 2:3 3:2 3:4 4:3 4:5 5:4 9:16 16:9 21:9`).
Capabilities differ **per route**, not per model — run `nanaban agent-info` for the exact matrix.

### Naming

Model names are matched ignoring case, spaces, and punctuation, and a family name always
resolves to the **newest** model in that family — so you never have to track version numbers:

| You write | You get |
|---|---|
| `gpt`, `gpt image`, `openai`, `chatgpt` | GPT Image 2 |
| `nb`, `nano banana`, `full`, `flash` | Nano Banana 2 |
| `lite` | Nano Banana 2 Lite |
| `pro` | Nano Banana 2 (no current Pro tier — see below) |

Costs are typical per-image rates via the standard paid API path. **gpt-image-2 is free** when routed through Codex OAuth because it decrements your ChatGPT Plus/Pro image quota rather than an API balance.

### Resolution: what each route can actually deliver

This is the one thing worth reading twice.

- The **free Codex route is hard-capped at ~1.57 megapixels and forces `quality=low`.** It
  ignores the size parameter entirely (verified across six configurations), and its aspect
  ratio is steered through the prompt, so the frame is approximate. It cannot produce 2K or
  4K by any means — nanaban excludes it from those requests before making a network call.
- **True 4K** comes from `nb2` — on `gemini-direct` with a Gemini key, or on OpenRouter, where
  4K is served only by the `-preview` provider ids that nanaban selects automatically.
- **There is no Pro model.** Nano Banana Pro is Gemini 3 Pro Image — a full generation behind
  `nb2`'s Gemini 3.1 — so it was removed in v7. `--model pro` resolves to `nb2`, and will
  repoint automatically if Google ships a 3.1 Pro.
- **Gemini models return JPEG only** — no Google API accepts `image/png`. GPT Image 2 returns
  PNG. nanaban corrects the output file extension to match the actual bytes.

Just ask for what you want (`--size 4k`) and let the router solve it. If nothing configured can
reach it, the error names the exact credential that would unlock it.

## Auth

nanaban detects credentials in this order and routes automatically. **Any single path is enough.**

| Source | Reaches | How to set |
|--------|---------|------------|
| `~/.codex/auth.json` (Codex OAuth) | `gpt-image-2` at $0 | `codex login` |
| `OPENROUTER_API_KEY` env | `nb2`, `nb-lite`, `gpt-image-2` (2K) | env var |
| Stored OpenRouter key | same as above | `nanaban auth set-openrouter <key>` |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `nb2`, `nb-lite` — **the most reliable path to 4K** | env var |
| Stored Gemini key | same as above | `nanaban auth set <key>` |

### Routing policy

1. **Preference order**: `gemini-direct` → `codex-oauth` → `openrouter`. `gemini-direct` comes first because it is the only route that delivers exact sizes and true 4K for the Gemini models. Among routes that all satisfy the request, the free one wins — so ordinary requests still cost $0 on a ChatGPT Plus/Pro machine.
2. **Automatic fallback**: if the preferred transport returns a transient failure (`RATE_LIMITED`, `NETWORK_ERROR`, `AUTH_INVALID`, `AUTH_EXPIRED`) nanaban retries on the next available transport. The success envelope gains a `fallbacks` array so the caller sees what happened.
3. **`--via <transport>` pins a route.** No fallback when explicit. Aliases: `codex`/`plus` → `codex-oauth`, `gemini`/`google` → `gemini-direct`, `or` → `openrouter`.

**Recommended stack for agents**: `codex login` + `OPENROUTER_API_KEY`. gpt-image-2 is free, OpenRouter is the failover for other models. Check what's reachable with `nanaban auth`, or live-validate every credential (and see OpenRouter credits remaining) with `nanaban auth --check`.

## Usage

```bash
nanaban "prompt"                          # auto-picks best model for your auth
nanaban "prompt" -o sunset.png            # custom filename
nanaban "prompt" --ar wide --size 2k      # 16:9, high resolution (Gemini only)
nanaban "prompt" --model lite             # Nano Banana 2 Lite (fastest, cheapest)
nanaban "prompt" --model gpt-image-2      # force GPT Image 2 (needs Codex auth)
nanaban "prompt" --model gpt              # force GPT Image 2 (latest GPT image model)
nanaban "prompt" --via codex-oauth        # force the ChatGPT sub route
nanaban "prompt" --neg "blurry, text"     # negative prompt (native on Gemini, prompt-emulated elsewhere)
nanaban "prompt" -r style.png             # reference image
nanaban edit photo.png "add sunglasses"   # edit existing image
nanaban upscale photo.png --scale 2          # upscale (real SR or labeled re-render)
```

### Flags

| Flag | What it does | Default |
|------|-------------|---------|
| `-o, --output <file>` | Output path | auto from prompt |
| `--ar <ratio>` | Aspect ratio (see table below) | `1:1` |
| `--size <size>` | Resolution: `0.5k` `1k` `2k` `4k`. Selects a route that can deliver it. | `1k` |
| `--quality <level>` | `low` `medium` `high`. Explicit `medium`/`high` excludes the free Codex route, which forces `low`. | model default |
| `--model <id>` | `gpt-image-2`, `nb2`, `nb-lite` — or any family alias (see Naming) | auto (resolution/aspect decide) |
| `--via <transport>` | `codex-oauth`, `gemini-direct`, `openrouter` | auto |
| `--neg <text>` | Negative prompt (Gemini only) | |
| `-r, --ref <file>` | Reference image (style/content guidance) | |
| `--open` | Open in default viewer after generating | off |
| `--json` | Structured JSON output for scripts | off |
| `--quiet` | Suppress non-essential output | off |

### Aspect Ratios

The ten standard aspect ratios, supported by every model:

| Ratio | Alias | Typical use |
|-------|-------|-------------|
| `1:1` | `square` | Avatars, icons, social posts |
| `16:9` | `wide` | Hero images, banners, wallpapers |
| `9:16` | `tall`, `story` | Phone wallpapers, stories, reels |
| `21:9` | `ultrawide` | Cinematic stills, ultrawide desktops |
| `3:2` | `landscape` | Classic photo landscape |
| `2:3` | `portrait` | Classic photo portrait, book covers |
| `4:3` | | Presentations, classic displays |
| `3:4` | | Portrait presentations |
| `5:4` | | Print, gallery framing |
| `4:5` | | Instagram portrait |

The extended `1:4`/`4:1`/`1:8`/`8:1` ratios were removed in v6 — no provider documents them, and
advertising a ratio that silently reframes is worse than a clean error listing what does work.

Aspect handling differs by route: Gemini and the metered OpenAI route take a real parameter and
return the frame **exactly**. The free Codex route has no such parameter — nanaban steers it
through the prompt, which works (16:9 verified) but is **approximate**. The JSON envelope reports
`aspect_fulfillment: "exact" | "approximate"` so callers never have to guess, and `dimensions` is
always measured from the returned bytes.

## Reference Images

Pass any image as a style or content reference with `-r`:

```bash
nanaban "portrait of a woman" -r painting_style.png
nanaban "modern living room" -r color_palette.jpg
nanaban "product shot" -r brand_reference.png
```

The model picks up on the visual language of your reference — color palette, composition, texture, artistic style — and applies it to your prompt. Useful for keeping a consistent look across a batch of images, matching brand aesthetics, or steering output toward a specific vibe without writing a 200-word prompt.

## Editing Existing Images

```bash
nanaban edit photo.png "remove the background"
nanaban edit headshot.png "make it a pencil sketch"
nanaban edit product.png "place on a marble table" --ar wide
```

Takes a source image and your edit instruction. Same flags apply — pick a model, change aspect ratio, resolution, or use Pro for finer edits. With no `--ar`, the output keeps the source image's aspect ratio.

## Upscaling

```bash
nanaban upscale photo.png                    # 2x, best available engine
nanaban upscale photo.png --scale 4          # 4x
nanaban upscale photo.png --engine crisp     # force Recraft Crisp Upscale
nanaban upscale face.png --face-enhance      # GFPGAN face restore (Real-ESRGAN)
```

Three engines, honestly labeled:

| Engine | What it is | Needs | ~Cost |
|--------|-----------|-------|-------|
| `real-esrgan` | True super-resolution (Replicate). Content-preserving, best-effort. | `REPLICATE_API_TOKEN` | $0.002/image |
| `crisp` | Recraft Crisp Upscale. Content-preserving, best-effort. | `RECRAFT_API_TOKEN` | $0.004/image |
| `rerender` | Generative re-render at 2K/4K through a generation model (default `nb2`). **Re-synthesizes every pixel — content can drift.** | any generation auth | model price |

`--engine auto` (the default) prefers real super-resolution and only falls back to `rerender` with a visible warning — the JSON envelope always states `method` (`super_resolution` vs `generative_rerender`) and `content_preservation`, so agents and scripts can never mistake one for the other.

## For LLM Agents and Scripts

`--json` gives machine-readable output. No spinners, no colors, no ambiguity:

```bash
nanaban "a red circle" --json
```

```json
{
  "status": "success",
  "file": "/Users/you/red_circle.png",
  "model": "gpt-image-2",
  "transport": "codex-oauth",
  "dimensions": { "width": 1024, "height": 1024 },
  "size_bytes": 1247283,
  "duration_ms": 12400,
  "cost_usd": 0
}
```

`cost_usd` is `0` for codex-oauth (billed against your ChatGPT sub), and reflects actual cost for OpenRouter/Gemini paid paths.

Errors come back in the same shape, with a `hint` the agent can act on:

```json
{
  "status": "error",
  "code": "AUTH_MISSING",
  "message": "No authentication configured. GPT Image 2 needs one of Codex OAuth (run `codex login`).",
  "hint": "pick one: `codex login` (free gpt-image-2 via ChatGPT Plus/Pro) | `nanaban auth set-openrouter <key>` | set GEMINI_API_KEY / OPENROUTER_API_KEY."
}
```

When auto-fallback kicks in and eventually succeeds, the success envelope carries a `fallbacks` audit trail:

```json
{
  "status": "success",
  "file": "/Users/you/fox_snow.png",
  "transport": "openrouter",
  "fallbacks": [
    { "transport": "codex-oauth", "code": "RATE_LIMITED", "message": "..." }
  ]
}
```

Error codes: `AUTH_MISSING`, `AUTH_INVALID`, `AUTH_EXPIRED`, `PROMPT_MISSING`, `BAD_ARGUMENT`, `IMAGE_NOT_FOUND`, `INPUT_TOO_LARGE`, `GENERATION_FAILED`, `CONTENT_BLOCKED`, `RATE_LIMITED`, `NETWORK_ERROR`, `TIMEOUT`, `MODEL_NOT_FOUND`, `TRANSPORT_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`, `OUTPUT_UNWRITABLE`.

Exit codes: `0` success · `1` transient (retry) · `2` config error (fix auth) · `3` bad input (fix arguments) · `4` rate limited (wait).

Discover everything machine-readably: `nanaban agent-info`.

### Piping

stdout is always just the file path. Metadata goes to stderr. These compose naturally:

```bash
nanaban "a cat" | xargs open                               # generate and open
nanaban "a cat" 2>/dev/null | pbcopy                       # copy path to clipboard
cat prompts.txt | while read p; do nanaban "$p"; done      # batch generate
```

### Skill install for Claude / Codex / Gemini

nanaban ships a tiny skill file so Claude Code, Codex, and Gemini know when to invoke it:

```bash
nanaban skill install   # writes ~/.claude/skills/nanaban/SKILL.md and peers
nanaban skill status    # shows where it's installed
```

The skill description is intentionally terse — the full capability surface lives in `nanaban agent-info`, which the agent queries on demand. This keeps the skill stable across nanaban versions.

## Auto-naming

Your prompt becomes the filename. Common words get stripped, capped at 6 words, joined with underscores:

```
"a fox in a snowy forest at dawn" -> fox_snowy_forest_dawn.png
```

Collisions auto-increment: `fox_snowy_forest.png`, `fox_snowy_forest_2.png`, `fox_snowy_forest_3.png`.

## Dependencies

Deliberately small:

- `@google/genai` + `google-auth-library` — Gemini API access
- `commander` — CLI parsing (~90KB)
- `nanospinner` — terminal spinner (~3KB)
- `picocolors` — terminal colors (~3KB)
- `tsx` + `typescript` — runs TypeScript source directly in npm/source installs
- OpenRouter, OpenAI Codex bridge — plain `fetch`, no SDK
- Standalone binaries bundle everything via `bun build --compile`

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

<p align="center">
  Built by <a href="https://github.com/longevityboris">Boris Djordjevic</a> at <a href="https://github.com/199-biotechnologies">199 Biotechnologies</a> | <a href="https://paperfoot.ai">Paperfoot AI</a>
</p>

<p align="center">
  <a href="https://github.com/paperfoot/nanaban-cli/stargazers"><img src="https://img.shields.io/github/stars/paperfoot/nanaban?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow" alt="Star this repo"></a>
  &nbsp;
  <a href="https://x.com/longevityboris"><img src="https://img.shields.io/badge/Follow_%40longevityboris-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow @longevityboris on X"></a>
</p>
