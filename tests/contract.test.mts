import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Drift guards: the manifest must be asserted against the REAL implementation
// exports, not against hand-copied literals that can rot independently.
import { TRANSPORT_PREFERENCE } from '../src/core/models.js';
import { EXIT_CODES, transientCodes } from '../src/lib/errors.js';
import { SKILL_CONTENT } from '../src/commands/skill.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');
const cli = join(root, 'src', 'cli.ts');

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(tsx, [cli, ...args], {
      cwd: root,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 10_000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('agent-info', () => {
  it('returns valid JSON', () => {
    const { stdout, exitCode } = run(['agent-info']);
    assert.equal(exitCode, 0, 'agent-info should exit 0');
    const manifest = JSON.parse(stdout);
    assert.equal(manifest.name, 'nanaban');
    assert.ok(manifest.version);
  });

  it('lists all commands', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const names = manifest.commands.map((c: any) => c.name);
    assert.ok(names.includes('generate'), 'missing generate');
    assert.ok(names.includes('edit'), 'missing edit');
    assert.ok(names.includes('auth'), 'missing auth');
    assert.ok(names.includes('auth set'), 'missing auth set');
    assert.ok(names.includes('agent-info'), 'missing agent-info');
    assert.ok(names.includes('skill install'), 'missing skill install');
    assert.ok(names.includes('update'), 'missing update');
  });

  it('lists all error codes', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const codes = manifest.error_codes.map((e: any) => e.code);
    for (const expected of ['AUTH_MISSING', 'AUTH_INVALID', 'AUTH_EXPIRED', 'PROMPT_MISSING', 'IMAGE_NOT_FOUND', 'GENERATION_FAILED', 'RATE_LIMITED', 'NETWORK_ERROR', 'MODEL_NOT_FOUND', 'TRANSPORT_UNAVAILABLE', 'CAPABILITY_UNSUPPORTED']) {
      assert.ok(codes.includes(expected), `missing error code: ${expected}`);
    }
  });

  it('declares every model with per-route capabilities', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    assert.ok(Array.isArray(manifest.models));
    const ids = manifest.models.map((m: any) => m.id);
    for (const expected of ['gpt-image-2', 'nb2', 'nb-pro', 'nb-lite']) {
      assert.ok(ids.includes(expected), `missing model: ${expected}`);
    }
    // The GPT Image 1-era models are gone, not merely flagged: leaving them
    // reachable is how `--model gpt` used to land on a retired stack.
    for (const gone of ['gpt5', 'gpt5-mini', 'gpt54', 'nb2-pro', 'nb2-lite']) {
      assert.ok(!ids.includes(gone), `retired model still declared: ${gone}`);
    }

    const byRoute = (id: string, t: string) =>
      manifest.models.find((m: any) => m.id === id).routes.find((r: any) => r.transport === t);

    // Capabilities are per route, never flat on the model.
    for (const m of manifest.models) {
      assert.ok(Array.isArray(m.routes) && m.routes.length > 0, `${m.id} must declare routes`);
      assert.equal(m.capabilities, undefined, `${m.id} must not declare flat capabilities`);
    }

    // The free Codex route must disclose its real ceiling, and must NOT claim
    // 2K/4K — an agent reading this should never plan a 4K job through it.
    const codex = byRoute('gpt-image-2', 'codex-oauth');
    assert.equal(codex.resolution_control.mode, 'fixed_pixel_budget');
    assert.equal(codex.resolution_control.supports_4k, false);
    assert.equal(codex.quality.mode, 'forced');
    assert.equal(codex.quality.effective, 'low');
    assert.equal(codex.aspect_control, 'prompt_steered_approximate');
    // ...but it must still advertise 16:9, which v5 wrongly refused.
    assert.ok(codex.aspect_ratios.includes('16:9'));

    // OpenRouter's openai/gpt-image-2 has no image endpoint — it must never
    // appear as a provider model anywhere in the manifest.
    assert.ok(!JSON.stringify(manifest).includes('"openai/gpt-image-2"'));

    // 4K on OpenRouter is served only by the -preview provider ids.
    const nb2or = byRoute('nb2', 'openrouter');
    assert.ok(nb2or.sizes.includes('4K'));
    assert.match(nb2or.provider_model_by_size['4K'], /preview/);
    assert.ok(!nb2or.provider_model.includes('preview'), 'non-4K sizes use the stable id');

    const nb2direct = byRoute('nb2', 'gemini-direct');
    assert.ok(nb2direct.sizes.includes('0.5K') && nb2direct.sizes.includes('4K'));

    // Pro is deliberately gemini-direct only: OpenRouter silently downgrades it
    // to 1376x768 while billing the full price.
    const pro = manifest.models.find((m: any) => m.id === 'nb-pro');
    assert.deepEqual(pro.routes.map((r: any) => r.transport), ['gemini-direct']);

    // Lite takes reference images — v5 declared 0 and refused edits outright.
    const lite = byRoute('nb-lite', 'gemini-direct');
    assert.deepEqual(lite.sizes, ['1K'], 'lite is 1K-only per Gemini API docs');
    assert.equal(lite.max_reference_images, 14);
    assert.equal(lite.supports_edit, true);
  });

  it('resolves family aliases to the current model, never a retired one', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const gpt = manifest.models.find((m: any) => m.id === 'gpt-image-2');
    // `gpt` and `mini` used to resolve to GPT-5 Image / GPT-5 Image Mini, both
    // built on the retiring GPT Image 1 stack.
    for (const a of ['gpt', 'gpt5', 'mini', 'openai']) {
      assert.ok(gpt.aliases.includes(a), `\`${a}\` must resolve to the current GPT image model`);
    }
    const nb2 = manifest.models.find((m: any) => m.id === 'nb2');
    for (const a of ['nb', 'nanobanana', 'full', 'flash']) {
      assert.ok(nb2.aliases.includes(a), `\`${a}\` must resolve to the current Nano Banana`);
    }
  });

  it('the embedded skill matches SKILL.md exactly', async () => {
    // SKILL.md is what humans edit; SKILL_CONTENT is what `nanaban skill install`
    // writes. They were hand-duplicated and had already drifted — pin them.
    const { SKILL_CONTENT } = await import('../src/commands/skill.ts');
    const onDisk = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');
    assert.equal(SKILL_CONTENT, onDisk, 'run `node scripts/sync-skill.mjs` after editing SKILL.md');
  });

  it('auth declares the --check live probe', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const auth = manifest.commands.find((c: any) => c.name === 'auth');
    assert.match(auth.description, /--check/, 'auth command must document --check');
  });

  it('declares all five transports (3 generation + 2 upscale)', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const ids = manifest.transports.map((t: any) => t.id);
    assert.deepEqual(ids.sort(), ['codex-oauth', 'gemini-direct', 'openrouter', 'recraft', 'replicate']);
  });

  it('preference order matches TRANSPORT_PREFERENCE (drift guard)', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    assert.deepEqual(manifest.auth_resolution.preference_order, TRANSPORT_PREFERENCE);
  });

  it('fallback retry codes match isTransient() exactly (drift guard)', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const fb = manifest.auth_resolution.fallback_behavior;
    assert.equal(fb.enabled, true, 'fallback must be enabled');
    assert.deepEqual(fb.retry_on_codes.slice().sort(), transientCodes().sort());
    assert.match(fb.disabled_when, /--via/, 'must document that --via disables fallback');
  });

  it('error envelope documents hint field', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    assert.match(manifest.output_contract.json_envelope.error, /hint/, 'error envelope must include hint');
  });

  it('every error code in the manifest matches EXIT_CODES (drift guard)', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const exitCodes = manifest.exit_codes.map((e: any) => e.code);
    assert.deepEqual(exitCodes.sort(), [0, 1, 2, 3, 4]);
    assert.deepEqual(
      manifest.error_codes.map((e: any) => e.code).sort(),
      Object.keys(EXIT_CODES).sort(),
      'manifest must list exactly the implemented error codes',
    );
    for (const e of manifest.error_codes) {
      assert.equal(e.exit_code, (EXIT_CODES as any)[e.code], `${e.code} exit code drifted`);
      assert.ok(e.recovery, `${e.code} must carry a recovery string`);
    }
  });

  it('declares the upscale operation with all three engines', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const up = manifest.operations.upscale;
    assert.equal(up.supported, true);
    const engines = up.engines.map((e: any) => e.engine);
    assert.deepEqual(engines.sort(), ['crisp', 'real-esrgan', 'rerender']);
    const rerender = up.engines.find((e: any) => e.engine === 'rerender');
    assert.equal(rerender.method, 'generative_rerender');
    assert.equal(rerender.content_preservation, 'not_preserved');
  });

  it('root SKILL.md is byte-identical to the installed skill content (drift guard)', () => {
    const onDisk = readFileSync(join(root, 'SKILL.md'), 'utf-8');
    assert.equal(onDisk, SKILL_CONTENT);
    assert.ok(!SKILL_CONTENT.includes('\\`'), 'skill must not contain broken backtick escapes');
    assert.match(SKILL_CONTENT, /```bash/, 'code fence must render correctly');
  });

  it('unknown model exits 3 (bad input)', () => {
    const { exitCode } = run(['a prompt', '--model', 'does-not-exist', '--json']);
    assert.equal(exitCode, 3);
  });

  it('lists env vars', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    const vars = manifest.env_vars.map((v: any) => v.name);
    assert.ok(vars.includes('GEMINI_API_KEY'));
    assert.ok(vars.includes('GOOGLE_API_KEY'));
    assert.ok(vars.includes('OPENROUTER_API_KEY'));
  });

  it('declares config path and format', () => {
    const { stdout } = run(['agent-info']);
    const manifest = JSON.parse(stdout);
    assert.equal(manifest.config.path, '~/.nanaban/config.json');
    assert.equal(manifest.config.format, 'json');
  });
});

describe('version and help', () => {
  it('--version exits 0', () => {
    const { exitCode, stdout } = run(['--version']);
    assert.equal(exitCode, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
  });

  it('--help exits 0', () => {
    const { exitCode } = run(['--help']);
    assert.equal(exitCode, 0);
  });

  it('edit --help exits 0', () => {
    const { exitCode } = run(['edit', '--help']);
    assert.equal(exitCode, 0);
  });

  it('auth --help exits 0', () => {
    const { exitCode } = run(['auth', '--help']);
    assert.equal(exitCode, 0);
  });

  it('skill --help exits 0', () => {
    const { exitCode } = run(['skill', '--help']);
    assert.equal(exitCode, 0);
  });
});

describe('exit codes', () => {
  it('no prompt is PROMPT_MISSING: exit 3, help on stderr, empty stdout', () => {
    const { stdout, stderr, exitCode } = run([]);
    assert.equal(exitCode, 3);
    assert.equal(stdout, '', 'stdout is reserved for the file path / JSON envelope');
    assert.match(stderr, /Usage: nanaban/);
  });

  it('no prompt with --json emits the PROMPT_MISSING envelope on stdout, exit 3', () => {
    const { stdout, exitCode } = run(['--json']);
    assert.equal(exitCode, 3);
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.status, 'error');
    assert.equal(envelope.code, 'PROMPT_MISSING');
    assert.ok(envelope.hint, 'every error envelope carries a hint');
  });

  it('unknown option with --json is BAD_ARGUMENT: exit 3 with envelope', () => {
    const { stdout, exitCode } = run(['hello', '--definitely-not-a-flag', '--json']);
    assert.equal(exitCode, 3);
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.status, 'error');
    assert.equal(envelope.code, 'BAD_ARGUMENT');
  });

  it('missing edit arguments exit 3, not 1 (1 means "transient — retry")', () => {
    const { exitCode } = run(['edit', 'photo.png', '--json']);
    assert.equal(exitCode, 3);
  });

  it('agent-info accepts --json (agents append it habitually)', () => {
    const { stdout, exitCode } = run(['agent-info', '--json']);
    assert.equal(exitCode, 0);
    JSON.parse(stdout);
  });

  it('missing -r reference file is IMAGE_NOT_FOUND exit 3, not GENERATION_FAILED exit 1', () => {
    const { stdout, exitCode } = run(['a red apple', '-r', '/definitely/not/a/file_xyz.png', '--json']);
    assert.equal(exitCode, 3);
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.code, 'IMAGE_NOT_FOUND');
  });

  it('upscale of a missing file is IMAGE_NOT_FOUND exit 3', () => {
    const { stdout, exitCode } = run(['upscale', '/definitely/not/a/file_xyz.png', '--json']);
    assert.equal(exitCode, 3);
    const envelope = JSON.parse(stdout);
    assert.equal(envelope.code, 'IMAGE_NOT_FOUND');
  });
});

describe('skill status', () => {
  it('--json returns valid JSON', () => {
    const { stdout, exitCode } = run(['skill', 'status', '--json']);
    assert.equal(exitCode, 0);
    const result = JSON.parse(stdout);
    assert.ok(Array.isArray(result.targets));
    assert.ok(result.targets.length > 0);
    assert.ok(result.targets[0].name);
    assert.ok(typeof result.targets[0].installed === 'boolean');
  });
});
