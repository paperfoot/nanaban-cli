import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const SKILL_CONTENT = `---
name: nanaban
description: >
  Generate and edit images from the terminal. Default model is Nano Banana 2 (Gemini),
  with Nano Banana Pro and OpenAI GPT-5 Image / GPT-5 Image Mini also available.
  Use when the user asks to create, generate, or make an image, picture, graphic,
  illustration, or visual. One key (Gemini direct OR OpenRouter) is enough — nanaban
  picks the right transport automatically. Run \\\`nanaban agent-info\\\` for the full
  machine-readable capability manifest.
---

# nanaban — Image Generation CLI

\\\`\\\`\\\`bash
nanaban "PROMPT"                          # generate, auto-name, save to CWD
nanaban "PROMPT" -o output.png            # custom filename
nanaban "PROMPT" --ar wide --size 2k      # 16:9, high resolution
nanaban "PROMPT" --pro                    # Nano Banana Pro (Gemini)
nanaban "PROMPT" --model gpt5             # GPT-5 Image (via OpenRouter)
nanaban "PROMPT" --model gpt5-mini        # GPT-5 Image Mini (via OpenRouter)
nanaban "PROMPT" --neg "blurry, text"     # negative prompt (Gemini only)
nanaban "PROMPT" -r style.png             # reference image (style or content guidance)
nanaban edit photo.png "add sunglasses"   # edit existing image
nanaban auth                              # show auth + reachable models
nanaban agent-info                        # machine-readable manifest
\\\`\\\`\\\`

## Auth — any single key works
nanaban detects available keys and routes automatically. You only need ONE of:
- **\\\`GEMINI_API_KEY\\\`** / **\\\`GOOGLE_API_KEY\\\`** — reaches Nano Banana 2 and Pro directly.
- **\\\`OPENROUTER_API_KEY\\\`** — reaches BOTH Nano Banana (via Google routing) AND GPT-5 Image / Mini.
- Stored variants via \\\`nanaban auth set <gemini-key>\\\` or \\\`nanaban auth set-openrouter <key>\\\`.

When both are set, nanaban prefers the direct path (lower latency). Override with \\\`--via openrouter\\\`.

## Models
| Id | Family | Best for | Aspect ratios | Sizes | ~Cost/img |
|----|--------|----------|---------------|-------|-----------|
| \\\`nb2\\\` (default) | Gemini | Fast, cheap, full ratio range | All + extended (1:4, 4:1, 1:8, 8:1) | 0.5K-4K | $0.067 |
| \\\`nb2-pro\\\` (\\\`--pro\\\`) | Gemini | Higher quality detail | Standard 10 | 1K-4K | $0.136 |
| \\\`gpt5\\\` | OpenAI | Strong text/UI rendering | 1:1, 2:3, 3:2 | 1K only | $0.193 |
| \\\`gpt5-mini\\\` | OpenAI | Cheaper OpenAI option | 1:1, 2:3, 3:2 | 1K only | $0.041 |

OpenAI models (\\\`gpt5\\\`, \\\`gpt5-mini\\\`) need OPENROUTER_API_KEY. They ignore non-square aspect ratios — output is always 1024×1024 regardless of \\\`--ar\\\`.

## Key flags
| Flag | Description | Default |
|------|-------------|---------|
| \\\`-o, --output <file>\\\` | Output path | auto from prompt |
| \\\`--ar <ratio>\\\` | 1:1, 16:9, 9:16, 4:3, etc. (also: square, wide, tall) | 1:1 |
| \\\`--size <size>\\\` | 0.5k, 1k, 2k, 4k | 1k |
| \\\`--pro\\\` | Nano Banana Pro (Gemini) | off |
| \\\`--model <id>\\\` | nb2, nb2-pro, gpt5, gpt5-mini | nb2 |
| \\\`--via <transport>\\\` | gemini-direct, openrouter | auto |
| \\\`--neg <text>\\\` | Negative prompt (Gemini only) | |
| \\\`-r, --ref <file>\\\` | Reference image | |
| \\\`--json\\\` | Structured JSON output | off |

## JSON mode
\\\`\\\`\\\`bash
nanaban "a red circle" --json
\\\`\\\`\\\`
Returns: \\\`{"status":"success","file":"...","model":"...","transport":"...","dimensions":{...},"size_bytes":N,"duration_ms":N,"cost_usd":N}\\\`

## Output contract
- stdout = file path only (pipeable: \\\`nanaban "cat" | xargs open\\\`)
- stderr = metadata, spinner, errors
- Exit codes: 0 success, 1 runtime error, 2 usage error

## When to choose which model
- Default to \\\`nb2\\\` (cheap, fast, all ratios).
- Use \\\`--pro\\\` for hero assets, text-in-image, fine detail.
- Use \\\`--model gpt5-mini\\\` if you want OpenAI's style (e.g., realistic UI mockups) on a budget.
- Use \\\`--model gpt5\\\` only when you need OpenAI's top tier.
`;

interface SkillTarget {
  name: string;
  dir: string;
  file: string;
}

function getTargets(): SkillTarget[] {
  const home = homedir();
  return [
    { name: 'Claude', dir: join(home, '.claude', 'skills', 'nanaban'), file: 'SKILL.md' },
    { name: 'Codex', dir: join(home, '.codex', 'skills', 'nanaban'), file: 'SKILL.md' },
    { name: 'Gemini', dir: join(home, '.gemini', 'skills', 'nanaban'), file: 'SKILL.md' },
  ];
}

export async function runSkillInstall(json: boolean): Promise<void> {
  const targets = getTargets();
  const results: { name: string; path: string; status: string }[] = [];

  for (const t of targets) {
    try {
      await mkdir(t.dir, { recursive: true });
      const fullPath = join(t.dir, t.file);
      await writeFile(fullPath, SKILL_CONTENT, 'utf-8');
      results.push({ name: t.name, path: fullPath, status: 'installed' });
    } catch (err) {
      results.push({ name: t.name, path: join(t.dir, t.file), status: `failed: ${(err as Error).message}` });
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify({ status: 'success', targets: results }) + '\n');
  } else {
    for (const r of results) {
      const icon = r.status === 'installed' ? '\u2713' : '\u2717';
      process.stderr.write(`${icon} ${r.name}: ${r.path}\n`);
    }
  }
}

export async function runSkillStatus(json: boolean): Promise<void> {
  const targets = getTargets();
  const results: { name: string; path: string; installed: boolean }[] = [];

  for (const t of targets) {
    const fullPath = join(t.dir, t.file);
    const installed = await access(fullPath).then(() => true).catch(() => false);
    results.push({ name: t.name, path: fullPath, installed });
  }

  if (json) {
    process.stdout.write(JSON.stringify({ targets: results }) + '\n');
  } else {
    for (const r of results) {
      const icon = r.installed ? '\u2713' : '\u2717';
      process.stderr.write(`${icon} ${r.name}: ${r.path}\n`);
    }
  }
}
