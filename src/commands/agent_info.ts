import { MODELS } from '../core/models.js';
import { VERSION } from '../version.js';

export function runAgentInfo(): void {
  const manifest = {
    name: 'nanaban',
    version: VERSION,
    description: 'Image generation from the terminal — Nano Banana (Gemini) and GPT Image via one CLI',
    transports: [
      {
        id: 'codex-oauth',
        description: "Direct ChatGPT Plus/Pro backend (Codex) using user's access token ($0 billed to sub)",
        auth_file: '~/.codex/auth.json',
      },
      {
        id: 'gemini-direct',
        description: 'Direct Gemini API via @google/genai SDK',
        env_keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        config_key: 'apiKey',
        oauth_supported: true,
      },
      {
        id: 'openrouter',
        description: 'OpenRouter chat completions endpoint (reaches Nano Banana + GPT-5 Image; does NOT reach gpt-image-2 — that needs codex-oauth)',
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
      policy: 'Pick the first available transport in preference order (codex-oauth, openrouter, gemini-direct). On a transient failure (RATE_LIMITED, NETWORK_ERROR, AUTH_INVALID, AUTH_EXPIRED) automatically retry on the next available transport. --via <transport> pins a single route and disables fallback. Any single key or auth file is enough — you do not need all of them.',
      preference_order: ['codex-oauth', 'openrouter', 'gemini-direct'],
      preference_rationale: "codex-oauth is preferred first because it is $0 for ChatGPT Plus subscribers and provides gpt-image-2. OpenRouter is tried second as it reaches every model with one key. gemini-direct is the third fallback for direct Google API users.",
      override_flag: '--via <transport>',
      fallback_behavior: {
        enabled: true,
        disabled_when: '--via <transport> is set',
        retry_on_codes: ['RATE_LIMITED', 'NETWORK_ERROR', 'AUTH_INVALID', 'AUTH_EXPIRED'],
        skip_on_codes: ['GENERATION_FAILED', 'CAPABILITY_UNSUPPORTED', 'MODEL_NOT_FOUND'],
        surfaces_as: 'success envelope gains a `fallbacks` array listing each failed transport hop (transport, code, message); error envelope message includes the full chain (e.g. "RATE_LIMITED (tried openrouter:RATE_LIMITED → gemini-direct:RATE_LIMITED)")',
      },
      recommendation: 'If you have ChatGPT Plus/Pro, `codex login` unlocks gpt-image-2 at $0 per image. Add OPENROUTER_API_KEY for reliability across every model (Nano Banana, GPT-5 Image) and automatic fallback.',
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
          { name: '--model', type: 'string', default: 'auto (gpt-image-2 when Codex OAuth is detected, else nb2)', description: 'Model id: gpt-image-2 | nb2 | nb2-lite | nb2-pro | gpt5 | gpt5-mini | gpt54 (aliases: gi2, pro, flash, lite, gpt, mini)' },
          { name: '--via', type: 'string', description: 'Force transport: codex-oauth | gemini-direct | openrouter (aliases: codex, plus, gemini, google, or)' },
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
        description: 'Show authentication status and reachable models. With --check: live-probe every credential (validates Gemini/OpenRouter keys upstream, decodes Codex token expiry) and report OpenRouter credits remaining. JSON gains a `checks` array; status becomes `degraded` if any probe fails.',
        usage: 'nanaban auth [--check] [--json]',
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
      { name: 'OPENROUTER_API_KEY', description: 'OpenRouter key — reaches Nano Banana + GPT-5 Image (not gpt-image-2)' },
      { name: 'NANABAN_OAUTH_CLIENT_ID', description: 'OAuth client ID for Gemini CLI auth' },
      { name: 'NANABAN_OAUTH_CLIENT_SECRET', description: 'OAuth client secret for Gemini CLI auth' },
      { name: 'NANABAN_CODEX_CARRIER', description: 'Escape hatch — overrides the Codex carrier model used by codex-oauth (default: gpt-5.4). Change if OpenAI rotates the Codex model list and gpt-5.4 stops being accepted.' },
    ],
    auth_files: [
      { path: '~/.codex/auth.json', description: 'ChatGPT Plus/Pro OAuth bundle from `codex login` — enables codex-oauth transport (gpt-image-2, billed against ChatGPT sub)' },
      { path: '~/.gemini/oauth_creds.json', description: 'Gemini CLI OAuth credentials (enables gemini-direct when NANABAN_OAUTH_CLIENT_ID/SECRET are set)' },
    ],
    exit_codes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'runtime error (generation, auth, network, transport)' },
      { code: 2, meaning: 'usage error (missing prompt, image not found, unsupported capability, unknown model)' },
    ],
    error_codes: [
      { code: 'AUTH_MISSING', description: 'No valid authentication found for the requested model', exit_code: 1, recovery: 'Run one of: `codex login` (enables gpt-image-2 at $0 via ChatGPT Plus/Pro), `nanaban auth set-openrouter <key>` (enables Nano Banana + GPT-5 Image), or set GEMINI_API_KEY / OPENROUTER_API_KEY in the environment.' },
      { code: 'AUTH_INVALID', description: 'Key or OAuth token was rejected by the upstream provider', exit_code: 1, recovery: 'Refresh the rejected credential: Codex → `codex login`; OpenRouter → https://openrouter.ai/keys; Gemini → https://aistudio.google.com/apikey. If another provider is already configured, nanaban will auto-fall-back transiently.' },
      { code: 'AUTH_EXPIRED', description: 'OAuth token expired', exit_code: 1, recovery: 'Re-auth with `codex login` (codex-oauth) or `gemini auth` (gemini-direct), or set OPENROUTER_API_KEY to bypass OAuth entirely.' },
      { code: 'PROMPT_MISSING', description: 'No prompt provided', exit_code: 2, recovery: 'Pass a prompt as the first positional argument: `nanaban "your prompt"`.' },
      { code: 'IMAGE_NOT_FOUND', description: 'Source image does not exist', exit_code: 2, recovery: 'Verify the path passed to `nanaban edit <image>` or `-r <file>` exists and is readable.' },
      { code: 'GENERATION_FAILED', description: 'Image generation failed (content policy, malformed request, or upstream error)', exit_code: 1, recovery: 'Usually a content-policy block or a malformed request — rewording the prompt often resolves it. Not retried on another transport because the other provider will reject for the same reason.' },
      { code: 'RATE_LIMITED', description: 'Upstream API rate limit exceeded (paid API tier cap, or ChatGPT sub image quota for codex-oauth)', exit_code: 1, recovery: 'Wait and retry. If you hit this on gpt-image-2 via codex-oauth, your ChatGPT Plus/Pro image quota is saturated — either wait for the quota window to reset or add `OPENROUTER_API_KEY` / `GEMINI_API_KEY` so nanaban can fall back to a paid transport automatically.' },
      { code: 'NETWORK_ERROR', description: 'Transient network / upstream 5xx', exit_code: 1, recovery: 'Retry. nanaban will also auto-fall-back to the next available transport on the same invocation.' },
      { code: 'MODEL_NOT_FOUND', description: 'Unknown model id', exit_code: 2, recovery: 'Run `nanaban agent-info` and pick from the `models` array. Canonical ids: gpt-image-2, nb2, nb2-lite, nb2-pro, gpt5, gpt5-mini, gpt54.' },
      { code: 'TRANSPORT_UNAVAILABLE', description: 'Forced transport cannot reach the requested model (e.g. `--via openrouter --model gpt-image-2`)', exit_code: 1, recovery: 'Drop `--via` to let nanaban pick an available transport, or switch to a model that this transport reaches (see `transport_ids` in agent-info).' },
      { code: 'CAPABILITY_UNSUPPORTED', description: 'Model does not support the requested aspect ratio, size, or operation', exit_code: 2, recovery: 'Check the model\'s `capabilities` in `nanaban agent-info`. GPT Image 2 only supports aspect ratios 1:1 / 2:3 / 3:2 at 1K.' },
    ],
    config: { path: '~/.nanaban/config.json', format: 'json' },
    output_contract: {
      stdout: 'File path only (pipeable). With --json: full JSON envelope.',
      stderr: 'Metadata, spinner, errors (human mode only)',
      json_envelope: {
        success: '{"status":"success","file":"...","model":"...","transport":"...","dimensions":{"width":N,"height":N},"size_bytes":N,"duration_ms":N,"cost_usd":N,"fallbacks":[{"transport":"...","code":"...","message":"..."}]}',
        success_notes: '`fallbacks` is only present when the preferred transport failed and auto-fallback kicked in; `transport` reflects the transport that actually succeeded.',
        error: '{"status":"error","code":"ERROR_CODE","message":"...","hint":"actionable recovery suggestion"}',
        error_notes: '`hint` is a human-readable recovery suggestion included on every error. Agents should read it — it names the exact command to run or env var to set.',
      },
    },
    install: 'npm install -g nanaban',
    repository: 'https://github.com/paperfoot/nanaban-cli',
  };

  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}
