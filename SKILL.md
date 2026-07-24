---
name: nanaban
description: Generate, edit, upscale, or modify images from the terminal via the `nanaban` CLI — use whenever the user asks to create, make, generate, render, draw, produce, design, edit, modify, upscale, enlarge, sharpen, or change an image, picture, photo, illustration, graphic, icon, logo, banner, hero, thumbnail, wallpaper, product shot, concept art, mockup, or visual. nanaban is the CLI, not a model — it routes to GPT Image 2 (free via Codex OAuth on ChatGPT Plus/Pro) and Nano Banana 2 / 2 Lite / Pro (Gemini), plus Real-ESRGAN / Recraft for true super-resolution upscaling. If the user says "nano banana", "gpt image", "lite", "pro", or "full", those are models nanaban serves via --model, not different tools. Run `nanaban agent-info` for the machine-readable manifest of every model, route, flag, and error code (including a per-code recovery map).
---

# nanaban

```bash
nanaban "PROMPT"                          # generate (auto-names file, saves to CWD)
nanaban "PROMPT" --ar 16:9 --size 4k      # true 4K — routes to a provider that can deliver it
nanaban "PROMPT" --model gpt              # pin a family; always gets the LATEST model in it
nanaban edit photo.png "add sunglasses"   # edit (keeps the source aspect ratio by default)
nanaban upscale photo.png --scale 2       # real SR with REPLICATE_API_TOKEN/RECRAFT_API_TOKEN, else labeled re-render
nanaban auth --check                      # live-validate keys, show credits
nanaban agent-info                        # full capability manifest (use this)
```

## Asking for a model

Names are matched ignoring case, spaces, and punctuation, and **a family name always
resolves to the newest model in that family** — you never need to know version numbers:

| You say | You get |
|---|---|
| `gpt`, `gpt image`, `openai`, `chatgpt` | GPT Image 2 |
| `nb`, `nano banana`, `full`, `flash` | Nano Banana 2 |
| `lite` | Nano Banana 2 Lite |
| `pro` | Nano Banana Pro |

Omit `--model` unless the user named one. The router picks for you.

## Getting high resolution — read this before planning a workaround

`--size` and `--quality` **select the route**. Ask for what you want and let the router
solve it; do not pre-emptively downgrade your request or design a crop/upscale pipeline.

- **`--size` omitted** → ~1K. Uses the free Codex route when available, at $0.
- **`--size 2k` / `4k`** → automatically moves to a provider that can actually deliver it.
  Real 4K is 5504×3072 at 16:9.
- The **free Codex route is hard-capped at ~1.57 megapixels with quality forced to low**,
  and its aspect ratio is prompt-steered, so it is approximate. It is excluded from 2K/4K
  requests before any network call. This is a provider ceiling, not a nanaban limit — no
  flag raises it.
- If nothing configured can reach the requested size, the error names the exact credential
  that would unlock it. Add the key; don't fall back to upscaling.

`upscale` is for enlarging an image you already have. It is **not** the way to get a
high-resolution generation — ask for `--size 4k` in the first place.

## Reading the result

Pass `--json` for a structured envelope. Trust these fields:

- `dimensions` — **measured from the returned bytes**, never assumed. Check it.
- `aspect_fulfillment` — `exact`, or `approximate` when the frame was only prompt-steered.
- `warnings` — route caveats worth surfacing to the user.
- `cost_usd` — `0` means it was billed to a subscription, not that it was free of charge.

Gemini models return **JPEG only** (no Google API accepts PNG); GPT Image 2 returns PNG.
nanaban corrects the output file's extension to match the real bytes, so the path in
`file` may not be the extension you passed to `-o`.

Without `--json`, stdout is just the file path — compose with `xargs`, `pbcopy`, etc.
Exit codes: 0 ok · 1 transient (retry) · 2 config (fix auth) · 3 bad input (fix args) · 4 rate-limited (wait).
