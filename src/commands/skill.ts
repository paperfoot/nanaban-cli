import { writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

// Intentionally minimal: the description is the critical field — it's what an LLM
// matches against the user's request to decide whether to invoke nanaban. The body
// is a one-line reminder to call `nanaban agent-info` for the full manifest, so the
// skill doesn't drift out of sync with real capabilities. Keep under ~1 KB.
const SKILL_CONTENT = `---
name: nanaban
description: Generate, edit, or modify images from the terminal via the \\\`nanaban\\\` CLI — use whenever the user asks to create, make, generate, render, draw, produce, design, edit, modify, or change an image, picture, photo, illustration, graphic, icon, logo, banner, hero, thumbnail, wallpaper, product shot, concept art, mockup, or visual. Defaults to GPT Image 2 on ChatGPT Plus/Pro (free via Codex OAuth) when available, otherwise Nano Banana 2. Run \\\`nanaban agent-info\\\` for the machine-readable manifest of every model, transport, flag, and error code (including a per-code recovery map).
---

# nanaban

\\\`\\\`\\\`bash
nanaban "PROMPT"                        # generate (auto-names file, saves to CWD)
nanaban "PROMPT" -o out.png --ar wide   # custom path, 16:9
nanaban edit photo.png "add sunglasses" # edit an existing image
nanaban auth                            # show what's reachable
nanaban auth --check                    # live-validate keys, show credits
nanaban agent-info                      # full capability manifest (use this)
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
