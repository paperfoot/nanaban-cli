import { Command } from 'commander';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runGenerate } from './commands/generate.js';
import { runEdit } from './commands/edit.js';
import { runAuthStatus, runAuthSet, runAuthSetOpenRouter } from './commands/auth.js';
import { runAgentInfo } from './commands/agent_info.js';
import { runSkillInstall, runSkillStatus } from './commands/skill.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')).version;

const program = new Command();

const ratiosHelp = '1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, 1:4, 4:1, 1:8, 8:1 (aliases: square, wide, tall, ultrawide, panoramic, banner, portrait, story)';

program
  .name('nanaban')
  .description('Image generation from the terminal — Nano Banana (Gemini) and GPT Image via one CLI')
  .version(VERSION, '-v, --version')
  .enablePositionalOptions()
  .argument('[prompt]', 'image generation prompt')
  .option('-o, --output <file>', 'output file path (auto-generated from prompt if omitted)')
  .option('--ar <ratio>', `aspect ratio: ${ratiosHelp}`, '1:1')
  .option('--size <size>', 'image size: 0.5k, 1k, 2k, 4k', '1k')
  .option('--pro', 'use Nano Banana Pro (alias for --model nb2-pro)', false)
  .option('--model <id>', 'model: nb2 (default), nb2-pro, gpt5, gpt5-mini')
  .option('--via <transport>', 'force transport: gemini-direct, openrouter')
  .option('--neg <text>', 'negative prompt (Gemini only)')
  .option('-r, --ref <file...>', 'reference image path(s)')
  .option('--open', 'open in default viewer after generation', false)
  .option('--json', 'structured JSON output for LLM/script piping', false)
  .option('--quiet', 'suppress non-essential output', false)
  .action(async (prompt: string | undefined, opts) => {
    if (!prompt) {
      program.help();
      return;
    }
    await runGenerate(prompt, opts);
  });

const editCmd = new Command('edit')
  .description('edit an existing image')
  .argument('<image>', 'path to the image to edit')
  .argument('<prompt>', 'edit instructions')
  .option('-o, --output <file>', 'output file path')
  .option('--ar <ratio>', `aspect ratio: ${ratiosHelp}`, '1:1')
  .option('--size <size>', 'image size: 0.5k, 1k, 2k, 4k', '1k')
  .option('--pro', 'use Nano Banana Pro (alias for --model nb2-pro)', false)
  .option('--model <id>', 'model: nb2 (default), nb2-pro, gpt5, gpt5-mini')
  .option('--via <transport>', 'force transport: gemini-direct, openrouter')
  .option('--neg <text>', 'negative prompt (Gemini only)')
  .option('--json', 'JSON output', false)
  .option('--quiet', 'suppress output', false)
  .option('--open', 'open after generation', false)
  .action(async (image: string, prompt: string, opts) => {
    await runEdit(image, prompt, opts);
  });

const authCmd = new Command('auth')
  .description('show authentication status and reachable models')
  .option('--json', 'JSON output', false)
  .action(async (opts) => {
    await runAuthStatus(opts.json);
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

const agentInfoCmd = new Command('agent-info')
  .description('machine-readable capability manifest')
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

program.addCommand(editCmd);
program.addCommand(authCmd);
program.addCommand(agentInfoCmd);
program.addCommand(skillCmd);

program.parseAsync().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
