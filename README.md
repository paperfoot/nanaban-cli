<p align="center">
  <img src="nanaban_logo.png" alt="nanaban — image generation from the terminal" width="600">
</p>

<h1 align="center">nanaban</h1>

<p align="center">
  Image generation from the terminal. Nano Banana (Gemini) <strong>and</strong> GPT Image. One CLI, one key.
</p>

<p align="center">
  <a href="https://github.com/paperfoot/nanaban-cli/stargazers"><img src="https://img.shields.io/github/stars/paperfoot/nanaban-cli?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow" alt="Star this repo"></a>
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
  Type a prompt. Get an image. Three seconds, one command, zero browser tabs. nanaban is a CLI for AI image generation that works for humans typing prompts and LLM agents calling <code>--json</code>. It runs on Google's Nano Banana (Gemini) and OpenAI GPT-5 Image — pick whichever, or let nanaban choose based on the keys you have.
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

Every image on this page was generated with nanaban. ~3 seconds each, straight from the terminal.

## Why This Exists

Most AI image generators make you open a browser, wait in a queue, click through UI, and download manually. That workflow breaks the second you need images inside a script, a CI pipeline, or an agent loop.

nanaban fixes that:

- **One command** -- type your prompt, get a file. No browser, no signup flow, no queue.
- **Two model families, one CLI** -- Nano Banana (Gemini) for the cheap/fast/extended-ratio default; GPT-5 Image for OpenAI's strong text and UI rendering.
- **Auto-names files** -- `"a fox in a snowy forest at dawn"` becomes `fox_snowy_forest_dawn.png`. No more `image_032_final_v2.png`.
- **Built for scripts** -- stdout is always the file path. `nanaban "a cat" | xargs open` just works.
- **Built for LLM agents** -- `--json` gives structured output with cost. Plug it into any AI pipeline.
- **Tiny footprint** -- runs TypeScript source directly, no build step.

## Install

```bash
npm install -g nanaban
```

Requires Node 18+. That is the only dependency.

From source:

```bash
git clone https://github.com/paperfoot/nanaban-cli.git
cd nanaban && npm install && npm link
```

## Quick Start

Pick one path:

**Gemini direct** (free tier available, fastest for Nano Banana):

```bash
# Get a key from https://aistudio.google.com/apikey (~30 seconds)
nanaban auth set AIzaSy...
nanaban "a fox in snow"
```

**OpenRouter** (one key for both Nano Banana AND GPT-5 Image):

```bash
# Get a key from https://openrouter.ai/keys
export OPENROUTER_API_KEY=sk-or-v1-...
nanaban "a fox in snow"                    # uses Nano Banana
nanaban "a fox in snow" --model gpt5-mini  # uses GPT-5 Image Mini
```

You only need **one** key. nanaban detects what's available and routes automatically. Run `nanaban auth` to see what's reachable.

## Models

| Id | Family | Best for | Aspect ratios | Sizes | ~Cost/img |
|----|--------|----------|---------------|-------|-----------|
| `nb2` (default) | Gemini Nano Banana 2 | Fast, cheap, full ratio range | All + extended (1:4, 4:1, 1:8, 8:1) | 0.5K-4K | $0.067 |
| `nb2-pro` (`--pro`) | Gemini Nano Banana Pro | Higher quality detail | Standard 10 | 1K-4K | $0.136 |
| `gpt5` | OpenAI GPT-5 Image | Strong text/UI rendering | 1:1, 2:3, 3:2 | 1K only | $0.193 |
| `gpt5-mini` | OpenAI GPT-5 Image Mini | Cheaper OpenAI option | 1:1, 2:3, 3:2 | 1K only | $0.041 |

Costs are typical per-image rates via OpenRouter. Direct Gemini pricing follows Google's published rates.

OpenAI models (`gpt5`, `gpt5-mini`) currently ignore non-square aspect ratios — output is always 1024×1024. nanaban accepts the `--ar` flag for them but the API itself doesn't honor it.

## Auth

nanaban detects keys in this order and routes automatically. **Any single key is enough.**

| Key | Reaches | Source |
|-----|---------|--------|
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | nb2, nb2-pro | env var |
| Stored Gemini key | nb2, nb2-pro | `nanaban auth set <key>` |
| Gemini OAuth | nb2, nb2-pro | `~/.gemini/oauth_creds.json` + OAuth client creds |
| `OPENROUTER_API_KEY` | nb2, nb2-pro, **gpt5, gpt5-mini** | env var |
| Stored OpenRouter key | All four | `nanaban auth set-openrouter <key>` |

When both Gemini direct and OpenRouter are configured, nanaban prefers the direct path (lower latency, no middleman markup). Override with `--via openrouter`.

Check what's reachable: `nanaban auth`.

## Usage

```bash
nanaban "prompt"                          # default: nb2 via best transport
nanaban "prompt" -o sunset.png            # custom filename
nanaban "prompt" --ar wide --size 2k      # 16:9, high resolution
nanaban "prompt" --pro                    # Nano Banana Pro
nanaban "prompt" --model gpt5             # GPT-5 Image (needs OpenRouter)
nanaban "prompt" --model gpt5-mini        # GPT-5 Image Mini
nanaban "prompt" --via openrouter         # force OpenRouter for any model
nanaban "prompt" --neg "blurry, text"     # negative prompt (Gemini only)
nanaban "prompt" -r style.png             # reference image
nanaban edit photo.png "add sunglasses"   # edit existing image
```

### Flags

| Flag | What it does | Default |
|------|-------------|---------|
| `-o, --output <file>` | Output path | auto from prompt |
| `--ar <ratio>` | Aspect ratio (see table below) | `1:1` |
| `--size <size>` | Resolution: `0.5k` `1k` `2k` `4k` (model-dependent) | `1k` |
| `--pro` | Use Nano Banana Pro (alias for `--model nb2-pro`) | off |
| `--model <id>` | `nb2`, `nb2-pro`, `gpt5`, `gpt5-mini` | `nb2` |
| `--via <transport>` | Force `gemini-direct` or `openrouter` | auto |
| `--neg <text>` | Negative prompt (Gemini only) | |
| `-r, --ref <file>` | Reference image (style/content guidance) | |
| `--open` | Open in default viewer after generating | off |
| `--json` | Structured JSON output for scripts | off |
| `--quiet` | Suppress non-essential output | off |

### Aspect Ratios

14 aspect ratios, from square to extreme panoramic:

| Ratio | Shorthand | Good for |
|-------|-----------|----------|
| `1:1` | `square` | Profile pics, thumbnails |
| `4:3` | | Photos, slides |
| `3:2` | | Classic photo format |
| `5:4` | | Print, posters |
| `16:9` | `wide` | Hero images, banners, wallpapers |
| `21:9` | `ultrawide` | Cinematic, ultrawide monitors |
| `4:1` | `panoramic` | Panoramas, website headers |
| `8:1` | `banner` | Extreme banners, ribbons |
| `3:4` | | Portrait photos |
| `2:3` | `portrait` | Book covers, tall posters |
| `4:5` | | Instagram portrait |
| `9:16` | `tall` / `story` | Phone wallpapers, stories |
| `1:4` | | Tall strips, infographic panels |
| `1:8` | | Extreme vertical banners |

Note: `1:4`, `4:1`, `1:8`, `8:1` are NB2-only. NB2 Pro supports the standard 10. GPT-5 Image / Mini support only `1:1`, `2:3`, `3:2` and the API ignores even those (always returns square). nanaban surfaces capability mismatches as `CAPABILITY_UNSUPPORTED` errors before any HTTP call.

## Reference Images

Pass any image as a style or content reference with `-r`:

```bash
nanaban "portrait of a woman" -r painting_style.png
nanaban "modern living room" -r color_palette.jpg
nanaban "product shot" -r brand_reference.png
```

The model picks up on the visual language of your reference -- color palette, composition, texture, artistic style -- and applies it to your prompt. Useful for keeping a consistent look across a batch of images, matching brand aesthetics, or steering output toward a specific vibe without writing a 200-word prompt.

## Editing Existing Images

```bash
nanaban edit photo.png "remove the background"
nanaban edit headshot.png "make it a pencil sketch"
nanaban edit product.png "place on a marble table" --ar wide
```

Takes a source image and your edit instruction. Same flags apply -- pick a model, change aspect ratio, resolution, or use Pro for finer edits.

## For LLM Agents and Scripts

`--json` gives machine-readable output. No spinners, no colors, no ambiguity:

```bash
nanaban "a red circle" --json
```

```json
{
  "status": "success",
  "file": "/Users/you/red_circle.png",
  "model": "google/gemini-3.1-flash-image-preview-20260226",
  "transport": "openrouter",
  "dimensions": { "width": 1024, "height": 1024 },
  "size_bytes": 1247283,
  "duration_ms": 12400,
  "cost_usd": 0.067
}
```

`cost_usd` appears when the transport reports it (currently OpenRouter only).

Errors come back in the same shape:

```json
{
  "status": "error",
  "code": "CAPABILITY_UNSUPPORTED",
  "message": "Nano Banana Pro does not support aspect ratio 1:8. Supported: 1:1, 2:3, 3:2, ..."
}
```

Error codes: `AUTH_MISSING`, `AUTH_INVALID`, `AUTH_EXPIRED`, `PROMPT_MISSING`, `IMAGE_NOT_FOUND`, `GENERATION_FAILED`, `RATE_LIMITED`, `NETWORK_ERROR`, `MODEL_NOT_FOUND`, `TRANSPORT_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`.

Exit codes: `0` success, `1` runtime error, `2` usage error.

Discover everything machine-readably: `nanaban agent-info`.

### Piping

stdout is always just the file path. Metadata goes to stderr. These compose naturally:

```bash
nanaban "a cat" | xargs open                              # generate and open
nanaban "a cat" 2>/dev/null | pbcopy                       # copy path to clipboard
cat prompts.txt | while read p; do nanaban "$p"; done      # batch generate
```

## Auto-naming

Your prompt becomes the filename. Common words get stripped, capped at 6 words, joined with underscores:

```
"a fox in a snowy forest at dawn" -> fox_snowy_forest_dawn.png
```

Collisions auto-increment: `fox_snowy_forest.png`, `fox_snowy_forest_2.png`, `fox_snowy_forest_3.png`.

## Dependencies

Deliberately small:

- `@google/genai` + `google-auth-library` -- Gemini API access
- `commander` -- CLI parsing (~90KB)
- `nanospinner` -- terminal spinner (~3KB)
- `picocolors` -- terminal colors (~3KB)
- `tsx` + `typescript` -- runs TypeScript source directly, no build step
- OpenRouter -- plain `fetch`, no SDK

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

<p align="center">
  Built by <a href="https://github.com/longevityboris">Boris Djordjevic</a> at <a href="https://github.com/199-biotechnologies">199 Biotechnologies</a> | <a href="https://paperfoot.ai">Paperfoot AI</a>
</p>

<p align="center">
  <a href="https://github.com/paperfoot/nanaban-cli/stargazers"><img src="https://img.shields.io/github/stars/paperfoot/nanaban-cli?style=for-the-badge&logo=github&label=%E2%AD%90%20Star%20this%20repo&color=yellow" alt="Star this repo"></a>
  &nbsp;
  <a href="https://x.com/longevityboris"><img src="https://img.shields.io/badge/Follow_%40longevityboris-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow @longevityboris on X"></a>
</p>
