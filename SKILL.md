---
name: nanaban
description: Generate, edit, upscale, or modify images from the terminal via the `nanaban` CLI — use whenever the user asks to create, make, generate, render, draw, produce, design, edit, modify, upscale, enlarge, sharpen, or change an image, picture, photo, illustration, graphic, icon, logo, banner, hero, thumbnail, wallpaper, product shot, concept art, mockup, or visual. nanaban is the CLI, not a model — it routes to GPT Image 2 (default on ChatGPT Plus/Pro, free via Codex OAuth), Nano Banana 2 / 2 Lite / Pro (Gemini), and GPT-5.x Image, plus Real-ESRGAN / Recraft for true super-resolution upscaling. If the user says "nano banana", that is a model nanaban serves (--model nb2, nb2-lite, or nb2-pro), not a different tool. Run `nanaban agent-info` for the machine-readable manifest of every model, transport, flag, and error code (including a per-code recovery map).
---

# nanaban

```bash
nanaban "PROMPT"                        # generate (auto-names file, saves to CWD)
nanaban "PROMPT" --ar wide --model nb2  # 16:9 via Nano Banana (default gpt-image-2 approximates non-square via prompt steering)
nanaban edit photo.png "add sunglasses" # edit (keeps the source aspect ratio by default)
nanaban upscale photo.png --scale 2     # upscale: real SR with REPLICATE_API_TOKEN/RECRAFT_API_TOKEN, else labeled generative re-render
nanaban auth --check                    # live-validate keys, show credits
nanaban agent-info                      # full capability manifest (use this)
```

Pass `--json` for a structured envelope (status/file/model/transport/cost_usd/duration_ms; errors carry code + hint). Without --json, stdout is just the file path — compose with `xargs`, `pbcopy`, etc. Exit codes: 0 ok · 1 transient (retry) · 2 config (fix auth) · 3 bad input (fix args) · 4 rate-limited (wait).
