import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MODELS } from '../core/models.js';

function getVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}

export function runAgentInfo(): void {
  const manifest = {
    name: 'nanaban',
    version: getVersion(),
    description: 'Image generation from the terminal — Nano Banana (Gemini) and GPT Image via one CLI',
    transports: [
      {
        id: 'gemini-direct',
        description: 'Direct Gemini API via @google/genai SDK',
        env_keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        config_key: 'apiKey',
        oauth_supported: true,
      },
      {
        id: 'openrouter',
        description: 'OpenRouter chat completions endpoint (reaches Gemini and OpenAI image models)',
        env_keys: ['OPENROUTER_API_KEY'],
        config_key: 'openRouterKey',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      },
    ],
    models: MODELS.map(m => ({
      id: m.id,
      display: m.display,
      family: m.family,
      aliases: m.aliases,
      transport_ids: m.ids,
      capabilities: {
        aspect_ratios: m.caps.aspectRatios,
        sizes: m.caps.sizes,
        max_reference_images: m.caps.maxRefImages,
        supports_edit: m.caps.edit,
        supports_negative_prompt: m.caps.negativePrompt,
      },
      cost_per_image_usd: m.costPerImageUsd,
    })),
    auth_resolution: {
      policy: 'For each request, pick the first available transport in preference order (gemini-direct, openrouter), unless --via overrides. Any single key is enough — you do not need both.',
      preference_order: ['gemini-direct', 'openrouter'],
      override_flag: '--via <transport>',
    },
    commands: [
      {
        name: 'generate',
        description: 'Generate an image from a text prompt (default command)',
        usage: 'nanaban "prompt" [flags]',
        args: [{ name: 'prompt', type: 'string', required: true, description: 'Image generation prompt' }],
        flags: [
          { name: '--output', short: '-o', type: 'string', description: 'Output file path (auto-generated from prompt if omitted)' },
          { name: '--ar', type: 'string', default: '1:1', description: 'Aspect ratio (see model capabilities)' },
          { name: '--size', type: 'string', default: '1k', description: 'Resolution: 0.5k, 1k, 2k, 4k (model-dependent)' },
          { name: '--pro', type: 'boolean', default: false, description: 'Alias for --model nb2-pro (Nano Banana Pro)' },
          { name: '--model', type: 'string', default: 'nb2', description: 'Model id: nb2, nb2-pro, gpt5, gpt5-mini' },
          { name: '--via', type: 'string', description: 'Force transport: gemini-direct, openrouter' },
          { name: '--neg', type: 'string', description: 'Negative prompt (Gemini only)' },
          { name: '--ref', short: '-r', type: 'string[]', description: 'Reference image path(s)' },
          { name: '--open', type: 'boolean', default: false, description: 'Open in default viewer after generation' },
          { name: '--json', type: 'boolean', default: false, description: 'Structured JSON output' },
          { name: '--quiet', type: 'boolean', default: false, description: 'Suppress non-essential output' },
        ],
      },
      {
        name: 'edit',
        description: 'Edit an existing image with a text instruction',
        usage: 'nanaban edit <image> "prompt" [flags]',
        args: [
          { name: 'image', type: 'string', required: true, description: 'Path to image to edit' },
          { name: 'prompt', type: 'string', required: true, description: 'Edit instructions' },
        ],
      },
      {
        name: 'auth',
        description: 'Show authentication status and reachable models',
        usage: 'nanaban auth',
      },
      {
        name: 'auth set',
        description: 'Store Gemini API key in ~/.nanaban/config.json',
        usage: 'nanaban auth set <key>',
      },
      {
        name: 'auth set-openrouter',
        description: 'Store OpenRouter key in ~/.nanaban/config.json',
        usage: 'nanaban auth set-openrouter <key>',
      },
      {
        name: 'agent-info',
        description: 'Machine-readable capability manifest (this output)',
        usage: 'nanaban agent-info',
      },
      {
        name: 'skill install',
        description: 'Install agent skill file to Claude, Codex, and Gemini skill directories',
        usage: 'nanaban skill install',
      },
      {
        name: 'skill status',
        description: 'Show which skill directories have nanaban installed',
        usage: 'nanaban skill status',
      },
    ],
    env_vars: [
      { name: 'GEMINI_API_KEY', description: 'Gemini API key (gemini-direct transport)' },
      { name: 'GOOGLE_API_KEY', description: 'Alternative Gemini API key' },
      { name: 'OPENROUTER_API_KEY', description: 'OpenRouter key — reaches both Gemini and OpenAI image models' },
      { name: 'NANABAN_OAUTH_CLIENT_ID', description: 'OAuth client ID for Gemini CLI auth' },
      { name: 'NANABAN_OAUTH_CLIENT_SECRET', description: 'OAuth client secret for Gemini CLI auth' },
    ],
    exit_codes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'runtime error (generation, auth, network, transport)' },
      { code: 2, meaning: 'usage error (missing prompt, image not found, unsupported capability, unknown model)' },
    ],
    error_codes: [
      { code: 'AUTH_MISSING', description: 'No valid authentication found for the requested model' },
      { code: 'AUTH_INVALID', description: 'API key was rejected' },
      { code: 'AUTH_EXPIRED', description: 'OAuth token expired' },
      { code: 'PROMPT_MISSING', description: 'No prompt provided' },
      { code: 'IMAGE_NOT_FOUND', description: 'Source image does not exist' },
      { code: 'GENERATION_FAILED', description: 'Image generation failed' },
      { code: 'RATE_LIMITED', description: 'API rate limit exceeded' },
      { code: 'NETWORK_ERROR', description: 'Network connectivity issue' },
      { code: 'MODEL_NOT_FOUND', description: 'Unknown model id' },
      { code: 'TRANSPORT_UNAVAILABLE', description: 'Forced transport cannot reach the requested model' },
      { code: 'CAPABILITY_UNSUPPORTED', description: 'Model does not support the requested aspect ratio, size, or operation' },
    ],
    config: { path: '~/.nanaban/config.json', format: 'json' },
    output_contract: {
      stdout: 'File path only (pipeable). With --json: full JSON envelope.',
      stderr: 'Metadata, spinner, errors (human mode only)',
      json_envelope: {
        success: '{"status":"success","file":"...","model":"...","transport":"...","dimensions":{"width":N,"height":N},"size_bytes":N,"duration_ms":N,"cost_usd":N}',
        error: '{"status":"error","code":"ERROR_CODE","message":"..."}',
      },
    },
    install: 'npm install -g nanaban',
    repository: 'https://github.com/paperfoot/nanaban-cli',
  };

  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}
