import { writeFile, mkdir, access, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// Intentionally minimal: the description is the critical field — it's what an LLM
// matches against the user's request to decide whether to invoke nanaban. The body
// is a one-line reminder to call `nanaban agent-info` for the full manifest, so the
// skill doesn't drift out of sync with real capabilities. Keep under ~1 KB.
export const SKILL_CONTENT = `---
name: nanaban
description: Generate, edit, upscale, or modify images from the terminal via the \`nanaban\` CLI — use whenever the user asks to create, make, generate, render, draw, produce, design, edit, modify, upscale, enlarge, sharpen, or change an image, picture, photo, illustration, graphic, icon, logo, banner, hero, thumbnail, wallpaper, product shot, concept art, mockup, or visual. nanaban is the CLI, not a model — it routes to GPT Image 2 (default on ChatGPT Plus/Pro, free via Codex OAuth), Nano Banana 2 / 2 Lite / Pro (Gemini), and GPT-5.x Image, plus Real-ESRGAN / Recraft for true super-resolution upscaling. If the user says "nano banana", that is a model nanaban serves (--model nb2, nb2-lite, or nb2-pro), not a different tool. Run \`nanaban agent-info\` for the machine-readable manifest of every model, transport, flag, and error code (including a per-code recovery map).
---

# nanaban

\`\`\`bash
nanaban "PROMPT"                        # generate (auto-names file, saves to CWD)
nanaban "PROMPT" --ar wide --model nb2  # 16:9 via Nano Banana (default gpt-image-2 approximates non-square via prompt steering)
nanaban edit photo.png "add sunglasses" # edit (keeps the source aspect ratio by default)
nanaban upscale photo.png --scale 2     # upscale: real SR with REPLICATE_API_TOKEN/RECRAFT_API_TOKEN, else labeled generative re-render
nanaban auth --check                    # live-validate keys, show credits
nanaban agent-info                      # full capability manifest (use this)
\`\`\`

Pass \`--json\` for a structured envelope (status/file/model/transport/cost_usd/duration_ms; errors carry code + hint). Without --json, stdout is just the file path — compose with \`xargs\`, \`pbcopy\`, etc. Exit codes: 0 ok · 1 transient (retry) · 2 config (fix auth) · 3 bad input (fix args) · 4 rate-limited (wait).
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
      // Remove the briefly-published slika skill (v5.0.0 rename, reverted)
      // so agents don't see two skills claiming the same trigger space.
      await rm(join(t.dir, '..', 'slika'), { recursive: true, force: true });
      await mkdir(t.dir, { recursive: true });
      const fullPath = join(t.dir, t.file);
      await writeFile(fullPath, SKILL_CONTENT, 'utf-8');
      results.push({ name: t.name, path: fullPath, status: 'installed' });
    } catch (err) {
      results.push({ name: t.name, path: join(t.dir, t.file), status: `failed: ${(err as Error).message}` });
    }
  }

  const failed = results.filter(r => r.status !== 'installed');
  if (json) {
    const status = failed.length === 0 ? 'success' : failed.length === results.length ? 'error' : 'partial';
    process.stdout.write(JSON.stringify({ status, targets: results }) + '\n');
  } else {
    for (const r of results) {
      const icon = r.status === 'installed' ? '\u2713' : '\u2717';
      process.stderr.write(`${icon} ${r.name}: ${r.path}\n`);
    }
  }
  if (failed.length === results.length) process.exitCode = 2;
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
