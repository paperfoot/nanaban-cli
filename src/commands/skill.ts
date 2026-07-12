import { writeFile, mkdir, access, rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// Intentionally minimal: the description is the critical field — it's what an LLM
// matches against the user's request to decide whether to invoke slika. The body
// is a one-line reminder to call `slika agent-info` for the full manifest, so the
// skill doesn't drift out of sync with real capabilities. Keep under ~1 KB.
const SKILL_CONTENT = `---
name: slika
description: Generate, edit, or modify images from the terminal via the \\\`slika\\\` CLI (formerly named nanaban) — use whenever the user asks to create, make, generate, render, draw, produce, design, edit, modify, or change an image, picture, photo, illustration, graphic, icon, logo, banner, hero, thumbnail, wallpaper, product shot, concept art, mockup, or visual. slika is the CLI, not a model — it routes to GPT Image 2 (default on ChatGPT Plus/Pro, free via Codex OAuth), Nano Banana 2 / 2 Lite / Pro (Gemini), and GPT-5.x Image. If the user says "nano banana", that is a model slika serves (--model nb2, nb2-lite, or nb2-pro), not a different tool. Run \\\`slika agent-info\\\` for the machine-readable manifest of every model, transport, flag, and error code (including a per-code recovery map).
---

# slika

\\\`\\\`\\\`bash
slika "PROMPT"                        # generate (auto-names file, saves to CWD)
slika "PROMPT" -o out.png --ar wide   # custom path, 16:9
slika edit photo.png "add sunglasses" # edit an existing image
slika auth                            # show what's reachable
slika auth --check                    # live-validate keys, show credits
slika agent-info                      # full capability manifest (use this)
\\\`\\\`\\\`

Pass \\\`--json\\\` for structured output (status/file/model/transport/cost_usd/duration_ms). Stdout is always just the file path — compose with \\\`xargs\\\`, \\\`pbcopy\\\`, etc.
`;

interface SkillTarget {
  name: string;
  dir: string;
  file: string;
}

function getTargets(): SkillTarget[] {
  const home = homedir();
  return [
    { name: 'Claude', dir: join(home, '.claude', 'skills', 'slika'), file: 'SKILL.md' },
    { name: 'Codex', dir: join(home, '.codex', 'skills', 'slika'), file: 'SKILL.md' },
    { name: 'Gemini', dir: join(home, '.gemini', 'skills', 'slika'), file: 'SKILL.md' },
  ];
}

export async function runSkillInstall(json: boolean): Promise<void> {
  const targets = getTargets();
  const results: { name: string; path: string; status: string }[] = [];

  for (const t of targets) {
    try {
      // Remove the legacy nanaban skill so agents don't see two skills
      // claiming the same trigger space (and confusing "nanaban" with
      // Google's Nano Banana models).
      await rm(join(t.dir, '..', 'nanaban'), { recursive: true, force: true });
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
