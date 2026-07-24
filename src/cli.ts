import { Command, CommanderError } from 'commander';
import { runGenerate, type GenerateCommandOpts } from './commands/generate.js';
import { runEdit } from './commands/edit.js';
import { runUpscale } from './commands/upscale.js';
import { runAuthStatus, runAuthSet, runAuthSetOpenRouter } from './commands/auth.js';
import { runAgentInfo } from './commands/agent_info.js';
import { runSkillInstall, runSkillStatus } from './commands/skill.js';
import { runUpdate } from './commands/update.js';
import { NB2Error } from './lib/errors.js';
import { createOutput } from './lib/output.js';
import { VERSION } from './version.js';

const program = new Command();

const ratiosHelp = '1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 (aliases: square, wide, tall, ultrawide, portrait, landscape, story)';
const modelHelp =
  'model — names are flexible: `gpt`/`gpt image` → GPT Image 2, `nb`/`nano banana`/`full` → Nano Banana 2, ' +
  '`lite` → Nano Banana 2 Lite, `pro` → Nano Banana Pro. Always resolves to the latest version of that family.';

// Agents parse stdout; every failure must honor the machine contract. Detect
// JSON intent from raw argv because parser-level errors (unknown option,
// missing argument) fire before any command's options are available.
const wantsJson = () => process.argv.includes('--json');

function contractExit(err: NB2Error): never {
  createOutput(wantsJson(), false).error(err);
  process.exit(err.exitCode);
}

function addGenerateOptions(cmd: Command): Command {
  return cmd
    .option('-o, --output <file>', 'output file path (auto-generated from prompt if omitted)')
    .option('--ar <ratio>', `aspect ratio: ${ratiosHelp}`, '1:1')
    // No default: an omitted --size means "1K is fine, free routes welcome",
    // while an explicit --size 1k is a hard constraint. The planner needs to
    // tell those apart to know when a fixed-budget route still qualifies.
    .option('--size <size>', 'image size: 0.5k, 1k, 2k, 4k (omit for 1k; asking for 2k/4k routes to a provider that can deliver it)')
    .option('--quality <level>', 'low | medium | high — explicit medium/high excludes the free Codex route, which forces low')
    .option('--model <id>', modelHelp)
    .option('--via <transport>', 'force transport: codex-oauth, gemini-direct, openrouter')
    .option('--neg <text>', 'negative prompt (native on Gemini; appended as "Avoid: ..." elsewhere)')
    .option('-r, --ref <file...>', 'reference image path(s)')
    .option('--open', 'open in default viewer after generation', false)
    .option('--json', 'structured JSON output for LLM/script piping', false)
    .option('--quiet', 'suppress non-essential output', false);
}

async function generateAction(prompt: string | undefined, opts: GenerateCommandOpts): Promise<void> {
  if (!prompt) {
    const err = new NB2Error('PROMPT_MISSING', 'No prompt provided. Usage: nanaban "your prompt"');
    if (!wantsJson()) program.outputHelp({ error: true });
    contractExit(err);
  }
  await runGenerate(prompt, opts);
}

addGenerateOptions(
  program
    .name('nanaban')
    .description('Image generation from the terminal — Nano Banana (Gemini) and GPT Image via one CLI')
    .version(VERSION, '-v, --version')
    .enablePositionalOptions()
    .argument('[prompt]', 'image generation prompt'),
).action(generateAction);

// Explicit `nanaban generate "..."` — the manifest has always advertised it.
const generateCmd = addGenerateOptions(
  new Command('generate')
    .description('generate an image (same as the bare `nanaban "PROMPT"` form)')
    .argument('[prompt]', 'image generation prompt'),
).action(generateAction);

const editCmd = new Command('edit')
  .description('edit an existing image')
  .argument('<image>', 'path to the image to edit')
  .argument('<prompt>', 'edit instructions')
  .option('-o, --output <file>', 'output file path')
  .option('--ar <ratio>', `aspect ratio (default: matches the source image): ${ratiosHelp}`)
  .option('--size <size>', 'image size: 0.5k, 1k, 2k, 4k (omit for 1k)')
  .option('--quality <level>', 'low | medium | high')
  .option('--model <id>', modelHelp)
  .option('--via <transport>', 'force transport: codex-oauth, gemini-direct, openrouter')
  .option('--neg <text>', 'negative prompt (native on Gemini; appended as "Avoid: ..." elsewhere)')
  .option('--json', 'JSON output', false)
  .option('--quiet', 'suppress output', false)
  .option('--open', 'open after generation', false)
  .action(async (image: string, prompt: string, opts) => {
    await runEdit(image, prompt, opts);
  });

const upscaleCmd = new Command('upscale')
  .description('upscale an image — real super-resolution when an engine key is set, generative re-render otherwise')
  .argument('<image>', 'path to the image to upscale')
  .option('--scale <factor>', 'upscale factor: 2 or 4', '2')
  .option('--engine <engine>', 'auto | real-esrgan (Replicate) | crisp (Recraft) | rerender (generative)', 'auto')
  .option('--model <id>', 'model for --engine rerender (default: nb2)')
  .option('--face-enhance', 'enable GFPGAN face enhancement (real-esrgan only; can alter identity)', false)
  .option('-o, --output <file>', 'output file path')
  .option('--json', 'JSON output', false)
  .option('--quiet', 'suppress output', false)
  .option('--open', 'open after upscaling', false)
  .action(async (image: string, opts) => {
    await runUpscale(image, opts);
  });

const authCmd = new Command('auth')
  .description('show authentication status and reachable models')
  .option('--json', 'JSON output', false)
  .option('--check', 'live-probe each credential (validates keys, reports OpenRouter credits)', false)
  .action(async (opts) => {
    await runAuthStatus(opts.json, opts.check);
  });

authCmd
  .command('set <key>')
  .description('store Gemini API key in ~/.nanaban/config.json')
  .option('--json', 'JSON output', false)
  .action(async (key: string, opts) => {
    await runAuthSet(key, opts.json);
  });

authCmd
  .command('set-openrouter <key>')
  .description('store OpenRouter key in ~/.nanaban/config.json')
  .option('--json', 'JSON output', false)
  .action(async (key: string, opts) => {
    await runAuthSetOpenRouter(key, opts.json);
  });

const updateCmd = new Command('update')
  .description('check for a newer release and print the exact upgrade command for your install channel')
  .option('--json', 'JSON output', false)
  .action(async (opts) => {
    await runUpdate(opts.json);
  });

const agentInfoCmd = new Command('agent-info')
  .description('machine-readable capability manifest')
  .option('--json', 'accepted for consistency (output is always JSON)', false)
  .action(() => {
    runAgentInfo();
  });

const skillCmd = new Command('skill').description('manage agent skill files');

skillCmd
  .command('install')
  .description('install skill to Claude, Codex, and Gemini')
  .option('--json', 'JSON output', false)
  .action(async (opts) => {
    await runSkillInstall(opts.json);
  });

skillCmd
  .command('status')
  .description('show installed skill locations')
  .option('--json', 'JSON output', false)
  .action(async (opts) => {
    await runSkillStatus(opts.json);
  });

program.addCommand(generateCmd);
program.addCommand(editCmd);
program.addCommand(upscaleCmd);
program.addCommand(authCmd);
program.addCommand(updateCmd);
program.addCommand(agentInfoCmd);
program.addCommand(skillCmd);

// Commander's own failures (unknown option, missing argument) must not bypass
// the typed contract: exit 3 with a JSON envelope when --json was requested,
// never exit 1 (which the manifest documents as "transient — retry").
// exitOverride is per-command and NOT inherited through addCommand — apply it
// to the whole tree or subcommand parse errors still process.exit(1).
function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub as Command);
}
applyExitOverride(program);

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') {
      process.exit(err.exitCode);
    }
    contractExit(new NB2Error('BAD_ARGUMENT', err.message.replace(/^error: /, '')));
  }
  const nerr = err instanceof NB2Error ? err : new NB2Error('GENERATION_FAILED', (err as Error)?.message ?? String(err));
  contractExit(nerr);
}
