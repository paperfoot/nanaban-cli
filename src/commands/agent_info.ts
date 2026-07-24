import { MODELS, TRANSPORT_PREFERENCE } from '../core/models.js';
import { EXIT_CODES, transientCodes, type ErrorCode } from '../lib/errors.js';
import { REPLICATE_MODEL, REPLICATE_EST_COST_USD } from '../core/transport-replicate.js';
import { RECRAFT_MODEL, RECRAFT_EST_COST_USD } from '../core/transport-recraft.js';
import { VERSION } from '../version.js';

// Recovery strings for the manifest's error table. Exit codes and the
// transient list are DERIVED from lib/errors.ts — the numbers here can never
// drift from what the CLI actually exits with.
const RECOVERY: Record<ErrorCode, string> = {
  AUTH_MISSING: 'Run one of: `codex login` (enables gpt-image-2 at $0 via ChatGPT Plus/Pro), `nanaban auth set-openrouter <key>` (enables Nano Banana + GPT Image models), or set GEMINI_API_KEY / OPENROUTER_API_KEY. For upscale engines: REPLICATE_API_TOKEN or RECRAFT_API_TOKEN.',
  AUTH_INVALID: 'Refresh the rejected credential: Codex → `codex login`; OpenRouter → https://openrouter.ai/keys; Gemini → https://aistudio.google.com/apikey. If another provider is configured, nanaban auto-falls-back transiently.',
  AUTH_EXPIRED: 'Re-auth with `codex login` (codex-oauth), or set OPENROUTER_API_KEY to bypass OAuth entirely. nanaban detects an expired ChatGPT token up front and skips the doomed route.',
  PROMPT_MISSING: 'Pass a prompt as the first positional argument: `nanaban "your prompt"`.',
  BAD_ARGUMENT: 'The invocation itself is malformed (unknown flag, missing argument). Fix the command line — retrying unchanged will fail identically.',
  IMAGE_NOT_FOUND: 'Verify the path passed to `nanaban edit <image>`, `nanaban upscale <image>`, or `-r <file>` exists and is a readable image.',
  INPUT_TOO_LARGE: 'The reference image exceeds the inline payload cap (default 20MB, override NANABAN_MAX_REF_BYTES). Downscale first, e.g. `sips -Z 2048 <file>`.',
  GENERATION_FAILED: 'Usually a content-policy block or malformed request — rewording the prompt often resolves it. Not retried on another transport because the other provider will reject for the same reason.',
  CONTENT_BLOCKED: 'The provider safety filter rejected the prompt or image. Reword the request; retrying unchanged fails identically.',
  RATE_LIMITED: 'Wait and retry. On gpt-image-2 via codex-oauth this means the ChatGPT Plus/Pro image quota is saturated — wait for the window to reset, or configure OPENROUTER_API_KEY so nanaban can fall back to a metered transport automatically (this spends money; the fallbacks array discloses it).',
  NETWORK_ERROR: 'Retry. nanaban also auto-falls-back to the next available transport on the same invocation.',
  TIMEOUT: 'The provider did not answer within the deadline (default 240s). Retry; raise NANABAN_TIMEOUT_MS for very large generations.',
  MODEL_NOT_FOUND: 'Run `nanaban agent-info` and pick from the `models` array. Canonical ids: gpt-image-2, nb2, nb-pro, nb-lite. Family aliases also work and always resolve to the latest model: `gpt`, `nano banana`, `full`, `lite`, `pro`.',
  TRANSPORT_UNAVAILABLE: 'The forced transport cannot reach the requested model with current auth. Drop `--via`, or switch to a model this transport reaches (see each model\'s `routes` array).',
  CAPABILITY_UNSUPPORTED: 'Check the per-route capabilities in `nanaban agent-info` (`models[].routes`), not per-model — the same model differs by transport. With no explicit --model, nanaban already picks a route that can satisfy the requested aspect/size/quality, so this code means NO configured route can. The message lists what was rejected and why.',
  OUTPUT_UNWRITABLE: 'The image WAS generated but could not be written to the requested location; the error message names the salvage path in the OS temp dir. Move it from there — do NOT re-run (that pays for a second generation).',
};

const DESCRIPTION: Record<ErrorCode, string> = {
  AUTH_MISSING: 'No valid authentication found for the requested model or engine',
  AUTH_INVALID: 'Key or OAuth token was rejected by the upstream provider',
  AUTH_EXPIRED: 'OAuth token expired (detected up front from the JWT exp claim)',
  PROMPT_MISSING: 'No prompt provided',
  BAD_ARGUMENT: 'Malformed invocation: unknown flag, missing argument, or invalid flag value',
  IMAGE_NOT_FOUND: 'Input or reference image does not exist / is not a readable image',
  INPUT_TOO_LARGE: 'Reference image exceeds the inline payload cap',
  GENERATION_FAILED: 'Image generation failed (malformed request or upstream error)',
  CONTENT_BLOCKED: 'Provider safety filter rejected the prompt or image',
  RATE_LIMITED: 'Upstream rate limit / quota exceeded (incl. ChatGPT sub image quota for codex-oauth)',
  NETWORK_ERROR: 'Transient network failure / upstream 5xx',
  TIMEOUT: 'Provider exceeded the request deadline (NANABAN_TIMEOUT_MS, default 240000)',
  MODEL_NOT_FOUND: 'Unknown model id',
  TRANSPORT_UNAVAILABLE: 'Forced transport cannot reach the requested model',
  CAPABILITY_UNSUPPORTED: 'No route can serve the requested aspect ratio, size, quality, or operation',
  OUTPUT_UNWRITABLE: 'Generated image could not be written to the requested output location',
};

export function runAgentInfo(): void {
  const manifest = {
    name: 'nanaban',
    version: VERSION,
    schema_version: '3.0',
    description: 'Image generation, editing, and upscaling from the terminal — GPT Image 2, Nano Banana 2/Lite/Pro (Gemini), GPT-5.x Image, plus Real-ESRGAN/Recraft super-resolution, via one CLI. nanaban is the router CLI, not a model — Nano Banana is one of the model families it serves.',
    transports: [
      {
        id: 'codex-oauth',
        description: "ChatGPT Plus/Pro backend (Codex) using the user's access token",
        auth_file: '~/.codex/auth.json',
        billing_mode: 'subscription_quota',
        disclosure: 'This is a reverse-engineered bridge to an experimental ChatGPT backend, not a supported OpenAI API. Image generations count against the ChatGPT subscription\'s image quota (shared with chatgpt.com usage). OpenAI could change or gate it at any time; if it breaks, use `--via openrouter` or a Gemini model. HARD CEILING (live-verified 2026-07-23): the bridge ignores the size parameter and always returns ~1.57 megapixels, and forces quality=low. It cannot produce 2K or 4K by any means, so nanaban excludes it from those requests before making a network call. Aspect ratio is steered through the prompt — approximate, not exact — and dimensions are always measured from the returned bytes, never assumed.',
      },
      {
        id: 'gemini-direct',
        description: 'Direct Gemini API via @google/genai SDK (API-key auth is the supported path)',
        env_keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        config_key: 'apiKey',
        oauth: 'experimental — requires NANABAN_OAUTH_CLIENT_ID/SECRET plus ~/.gemini/oauth_creds.json; unverified against the current SDK. Use an API key.',
        billing_mode: 'metered',
      },
      {
        id: 'openrouter',
        description: 'OpenRouter chat completions endpoint — one key reaches every OR-routed model. Note: openai/gpt-image-2 is listed in OpenRouter\'s catalog but has NO image endpoint (404s); the working path to the GPT Image 2 stack here is openai/gpt-5.4-image-2. Gemini 4K is served only by the -preview provider ids.',
        env_keys: ['OPENROUTER_API_KEY'],
        config_key: 'openRouterKey',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        billing_mode: 'metered',
      },
      {
        id: 'replicate',
        description: 'Replicate — upscale operation only (Real-ESRGAN super-resolution)',
        env_keys: ['REPLICATE_API_TOKEN'],
        config_key: 'replicateKey',
        billing_mode: 'metered',
      },
      {
        id: 'recraft',
        description: 'Recraft — upscale operation only (Crisp Upscale)',
        env_keys: ['RECRAFT_API_TOKEN'],
        config_key: 'recraftKey',
        billing_mode: 'metered',
      },
    ],
    operations: {
      generate: { supported: true, command: 'nanaban "prompt" (or: nanaban generate "prompt")' },
      edit: { supported: true, command: 'nanaban edit <image> "instructions"', default_aspect: 'matches the source image (pass --ar to override; older versions silently forced 1:1)' },
      upscale: {
        supported: true,
        command: 'nanaban upscale <image> [--scale 2|4] [--engine auto|real-esrgan|crisp|rerender]',
        engines: [
          {
            engine: 'real-esrgan',
            transport: 'replicate',
            provider_model: REPLICATE_MODEL,
            method: 'super_resolution',
            content_preservation: 'best_effort',
            scale_factors: [2, 4],
            face_enhance: 'optional, off by default (can alter identity)',
            est_cost_usd: REPLICATE_EST_COST_USD,
            requires: 'REPLICATE_API_TOKEN',
            uploads_input: true,
          },
          {
            engine: 'crisp',
            transport: 'recraft',
            provider_model: RECRAFT_MODEL,
            method: 'super_resolution',
            content_preservation: 'best_effort',
            scale_factors: 'service-chosen (up to ~4096px edge); --scale is advisory',
            est_cost_usd: RECRAFT_EST_COST_USD,
            requires: 'RECRAFT_API_TOKEN',
            uploads_input: true,
          },
          {
            engine: 'rerender',
            transport: 'gemini-direct | openrouter (via the normal generation routing)',
            method: 'generative_rerender',
            content_preservation: 'not_preserved',
            warning: 'Re-synthesizes every pixel at 2K/4K — content can drift. Never silently substituted for super-resolution: the envelope labels method and carries a warning.',
            default_model: 'nb2',
            requires: 'any generation auth (works with zero upscaler keys)',
          },
        ],
        selection: 'auto prefers real-esrgan, then crisp, then rerender-with-warning. Explicit --engine with a missing key errors (AUTH_MISSING) instead of substituting.',
      },
    },
    models: MODELS.map(m => ({
      id: m.id,
      display: m.display,
      family: m.family,
      aliases: m.aliases,
      alias_policy: 'Family names resolve version-agnostically to the CURRENT model — `gpt` is always the latest GPT image model, never a retired one. Matching ignores case, spaces, and punctuation, so "GPT Image", "gpt-image" and "gptimage" are the same.',
      // Capabilities live on ROUTES, never on the model: the same model behaves
      // differently per transport, and publishing one flat set is what made
      // agents plan around limits that did not exist on the route they used.
      routes: Object.entries(m.routes).map(([transport, c]) => ({
        route_id: `${m.id}/${transport}`,
        transport,
        provider_model: c.providerModel,
        ...(c.providerModelBySize ? { provider_model_by_size: c.providerModelBySize } : {}),
        lifecycle: c.lifecycle,
        billing: c.billing,
        est_cost_per_image_usd: c.costPerImageUsd,
        aspect_ratios: c.aspectRatios,
        aspect_control: c.aspectExact ? 'exact_parameter' : 'prompt_steered_approximate',
        sizes: c.sizes,
        resolution_control: c.fixedPixelBudget
          ? {
              mode: 'fixed_pixel_budget',
              approx_megapixels: Number((c.fixedPixelBudget / 1e6).toFixed(2)),
              size_parameter_ignored: true,
              supports_2k: false,
              supports_4k: false,
            }
          : { mode: 'native_tiers', size_parameter_honored: true },
        quality: c.forcedQuality
          ? { mode: 'forced', effective: c.forcedQuality }
          : c.quality
            ? { mode: 'selectable', values: c.quality }
            : { mode: 'model_defined' },
        max_reference_images: c.maxRefImages,
        supports_edit: c.edit,
        output_format: m.family === 'gemini' ? 'image/jpeg (Gemini emits JPEG only)' : 'image/png',
        ...(c.notes ? { notes: c.notes } : {}),
      })),
      ...(m.notes ? { notes: m.notes } : {}),
    })),
    routing: {
      explicit_size_is_hard_constraint: true,
      explicit_quality_is_hard_constraint: true,
      unpinned_model_may_change_to_satisfy_request: true,
      pinned_model_never_silently_changes: true,
      codex_is_never_used_for_2k_or_4k: true,
      note: '--size/--quality SELECT the route. Asking for 2k/4k without --model picks a provider that can actually deliver it rather than failing the default. Omitting --size leaves the free Codex route eligible.',
    },
    verified: {
      date: '2026-07-23',
      method: 'live probes against each provider',
      findings: [
        'codex-oauth ignores tools[].size in all 6 tested configurations and returns ~1.57MP (1254x1254) with quality forced to low.',
        'openai/gpt-image-2 on OpenRouter has no image endpoint (404); openai/gpt-5.4-image-2 is the working OpenRouter path.',
        'OpenRouter serves Gemini 4K only from -preview provider ids; stable ids reject it.',
        'Nano Banana Pro on OpenRouter returns 1376x768 at every requested size while billing the full price — that route is not offered.',
        'Gemini returns JPEG only; no API accepts image/png.',
      ],
    },
    pricing_note: 'Costs live on routes, not models: est_cost_per_image_usd is the 1K estimate and Gemini pricing scales with output size (nb-pro is ~$0.24 at 4K). Routes with billing: subscription_quota report cost_usd: 0 because they debit the ChatGPT subscription, not a metered balance. OpenRouter routes report actual metered cost in the envelope when available.',
    auth_resolution: {
      policy: 'Pick the first available transport in preference order. On a transient failure automatically retry on the next available transport. --via <transport> pins a single route and disables fallback. Any single key or auth file is enough — you do not need all of them. An expired Codex token (JWT exp in the past) is treated as unavailable for auto-selection.',
      preference_order: TRANSPORT_PREFERENCE,
      preference_rationale: 'gemini-direct first: it is the only route that delivers true 4K and exact sizes for the Gemini models (OpenRouter caps them and silently downgrades Pro). codex-oauth second because it is $0 for ChatGPT Plus/Pro subscribers, but it is excluded up front for any request it cannot satisfy. OpenRouter last as the universal metered fallback.',
      override_flag: '--via <transport>',
      model_auto_selection: 'With no --model, the requested size/aspect/quality select the route. Every model+transport pair that can satisfy the request is ranked: exact aspect and true resolution outrank a fixed-budget route, then free outranks metered, then cheaper wins. So a plain 1K request uses the free Codex route where available, and --size 2k/4k automatically moves to a provider that can actually deliver it instead of erroring.',
      fallback_behavior: {
        enabled: true,
        disabled_when: '--via <transport> is set',
        retry_on_codes: transientCodes(),
        skip_on_codes: ['GENERATION_FAILED', 'CONTENT_BLOCKED', 'CAPABILITY_UNSUPPORTED', 'MODEL_NOT_FOUND'],
        cost_caution: 'Fallback can cross from the $0 codex-oauth route to metered OpenRouter (gpt-image-2 has both). Every hop is disclosed in the `fallbacks` array; pin `--via codex-oauth` to forbid paid fallback.',
        surfaces_as: 'success envelope gains a `fallbacks` array listing each failed transport hop (transport, code, message); error envelope message includes the full chain',
      },
      recommendation: 'If you have ChatGPT Plus/Pro, `codex login` unlocks gpt-image-2 at $0 per image. Add OPENROUTER_API_KEY for reliability across every model and automatic (metered) failover.',
    },
    commands: [
      {
        name: 'generate',
        description: 'Generate an image from a text prompt (default command; also available as an explicit subcommand)',
        usage: 'nanaban "prompt" [flags]  |  nanaban generate "prompt" [flags]',
        args: [{ name: 'prompt', type: 'string', required: true, description: 'Image generation prompt' }],
        flags: [
          { name: '--output', short: '-o', type: 'string', description: 'Output file path (auto-generated from prompt if omitted; extension follows actual MIME type)' },
          { name: '--ar', type: 'string', default: '1:1', description: 'Aspect ratio (see model capabilities; aliases: square, wide, tall, ultrawide, panoramic, banner, portrait, story)' },
          { name: '--size', type: 'string', default: '1k', description: 'Resolution: 0.5k, 1k, 2k, 4k (model-dependent)' },
          { name: '--quality', type: 'string', default: 'unset (model default)', description: 'low | medium | high. Explicit medium/high excludes the codex-oauth route, which forces low.' },
          { name: '--model', type: 'string', default: 'auto (see auth_resolution.model_auto_selection)', description: 'gpt-image-2 | nb2 | nb-pro | nb-lite. Names are matched ignoring case, spaces and punctuation, and family names always resolve to the latest model: `gpt`/`gpt image` → GPT Image 2, `nb`/`nano banana`/`full` → Nano Banana 2, `lite` → Nano Banana 2 Lite, `pro` → Nano Banana Pro.' },
          { name: '--via', type: 'string', description: 'Force transport: codex-oauth | gemini-direct | openrouter (aliases: codex, plus, gemini, google, or)' },
          { name: '--neg', type: 'string', description: 'Negative prompt — native on Gemini models, appended as "Avoid: ..." prompt text elsewhere' },
          { name: '--ref', short: '-r', type: 'string[]', description: 'Reference image path(s); max 20MB each (NANABAN_MAX_REF_BYTES)' },
          { name: '--open', type: 'boolean', default: false, description: 'Open in default viewer after generation (open/xdg-open/start)' },
          { name: '--json', type: 'boolean', default: false, description: 'Structured JSON output' },
          { name: '--quiet', type: 'boolean', default: false, description: 'Suppress non-essential output' },
        ],
      },
      {
        name: 'edit',
        description: 'Edit an existing image with a text instruction. Default aspect ratio matches the source image.',
        usage: 'nanaban edit <image> "prompt" [flags]',
        args: [
          { name: 'image', type: 'string', required: true, description: 'Path to image to edit' },
          { name: 'prompt', type: 'string', required: true, description: 'Edit instructions' },
        ],
        flags: [
          { name: '--ar', type: 'string', default: 'auto (source aspect)', description: 'Override the inferred aspect ratio' },
          { name: '--size', type: 'string', default: '1k', description: 'Resolution: 0.5k, 1k, 2k, 4k (model-dependent)' },
          { name: '--model / --quality / --via / --neg / -o / --open / --json / --quiet', type: 'mixed', description: 'Same semantics as generate' },
        ],
      },
      {
        name: 'upscale',
        description: 'Upscale an image. Real super-resolution when an engine key is configured; explicit generative re-render otherwise (always labeled in the envelope, never silent).',
        usage: 'nanaban upscale <image> [--scale 2|4] [--engine auto|real-esrgan|crisp|rerender] [flags]',
        args: [{ name: 'image', type: 'string', required: true, description: 'Path to the image to upscale' }],
        flags: [
          { name: '--scale', type: 'number', default: 2, description: '2 or 4' },
          { name: '--engine', type: 'string', default: 'auto', description: 'auto | real-esrgan | crisp | rerender (see operations.upscale)' },
          { name: '--model', type: 'string', default: 'nb2', description: 'Generation model for --engine rerender' },
          { name: '--face-enhance', type: 'boolean', default: false, description: 'GFPGAN face enhancement (real-esrgan only; can alter identity)' },
          { name: '-o / --open / --json / --quiet', type: 'mixed', description: 'Same semantics as generate' },
        ],
      },
      {
        name: 'auth',
        description: 'Show authentication status and reachable models. With --check: live-probe every credential (validates Gemini/OpenRouter keys upstream, decodes Codex token expiry) and report OpenRouter credits remaining. JSON gains a `checks` array; status becomes `degraded` if any probe fails. Without --check, reachability reflects credential PRESENCE, not validity.',
        usage: 'nanaban auth [--check] [--json]',
      },
      { name: 'auth set', description: 'Store Gemini API key in ~/.nanaban/config.json', usage: 'nanaban auth set <key>' },
      { name: 'auth set-openrouter', description: 'Store OpenRouter key in ~/.nanaban/config.json', usage: 'nanaban auth set-openrouter <key>' },
      { name: 'update', description: 'Check the latest GitHub release and print the exact upgrade command for the detected install channel (homebrew | npm | standalone binary). Never self-replaces managed installs.', usage: 'nanaban update [--json]' },
      { name: 'agent-info', description: 'Machine-readable capability manifest (this output). --json is accepted as a no-op.', usage: 'nanaban agent-info [--json]' },
      { name: 'skill install', description: 'Install agent skill file to Claude, Codex, and Gemini skill directories. JSON status: success | partial | error.', usage: 'nanaban skill install' },
      { name: 'skill status', description: 'Show which skill directories have nanaban installed', usage: 'nanaban skill status' },
    ],
    env_vars: [
      { name: 'GEMINI_API_KEY', description: 'Gemini API key (gemini-direct transport)' },
      { name: 'GOOGLE_API_KEY', description: 'Alternative Gemini API key' },
      { name: 'OPENROUTER_API_KEY', description: 'OpenRouter key — reaches every OR-routed model including gpt-image-2 (metered)' },
      { name: 'REPLICATE_API_TOKEN', description: 'Replicate token — enables the real-esrgan upscale engine (~$0.002/image)' },
      { name: 'RECRAFT_API_TOKEN', description: 'Recraft token — enables the crisp upscale engine (~$0.004/image)' },
      { name: 'NANABAN_TIMEOUT_MS', description: 'Overall per-request provider deadline in ms (default 240000). Every transport aborts and exits TIMEOUT (code 1) past it — no more indefinite hangs.' },
      { name: 'NANABAN_MAX_REF_BYTES', description: 'Per-reference-image size cap in bytes (default 20971520)' },
      { name: 'NANABAN_CODEX_CARRIER', description: 'Escape hatch — overrides the Codex carrier model used by codex-oauth (default: gpt-5.4). Change if OpenAI rotates the Codex model list.' },
      { name: 'NANABAN_CODEX_MAX_RETRIES', description: 'In-process retries for the known Codex bridge stream-flake pattern (default 2)' },
      { name: 'NANABAN_OAUTH_CLIENT_ID', description: 'OAuth client ID for experimental Gemini CLI auth' },
      { name: 'NANABAN_OAUTH_CLIENT_SECRET', description: 'OAuth client secret for experimental Gemini CLI auth' },
    ],
    auth_files: [
      { path: '~/.codex/auth.json', description: 'ChatGPT Plus/Pro OAuth bundle from `codex login` — enables codex-oauth transport (gpt-image-2, billed against ChatGPT sub quota). An expired token is detected and skipped for auto-selection.' },
      { path: '~/.gemini/oauth_creds.json', description: 'Gemini CLI OAuth credentials (experimental; API-key auth is the supported path)' },
    ],
    exit_codes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'transient error (generation, network, timeout) — retry with backoff' },
      { code: 2, meaning: 'config error (missing/invalid/expired auth, unreachable transport) — fix setup, do not retry' },
      { code: 3, meaning: 'bad input (missing prompt, bad flag, image not found, unknown model, unsupported capability, content blocked, output unwritable) — fix arguments, do not blind-retry' },
      { code: 4, meaning: 'rate limited — wait, then retry' },
    ],
    error_codes: (Object.keys(EXIT_CODES) as ErrorCode[]).map(code => ({
      code,
      description: DESCRIPTION[code],
      exit_code: EXIT_CODES[code],
      recovery: RECOVERY[code],
    })),
    config: { path: '~/.nanaban/config.json', format: 'json' },
    output_contract: {
      stdout: 'File path only (pipeable). With --json: full JSON envelope.',
      stderr: 'Metadata, spinner, errors, warnings (human mode only)',
      json_envelope: {
        success: '{"status":"success","file":"...","model":"<canonical id, e.g. nb2>","provider_model":"<upstream id, when it differs>","transport":"...","mime_type":"image/png","dimensions":{"width":N,"height":N},"size_bytes":N,"duration_ms":N,"cost_usd":N,"fallbacks":[...],"warnings":[...]}',
        success_notes: 'dimensions are MEASURED from the returned bytes, never assumed from the request. Upscale results add operation/method/engine/content_preservation/scale. `fallbacks` appears only when auto-fallback fired; `warnings` carries honesty notes (e.g. generative re-render used).',
        error: '{"status":"error","code":"ERROR_CODE","message":"...","hint":"actionable recovery suggestion"}',
        error_notes: '`hint` is included on every error envelope. Agents should read it — it names the exact command to run or env var to set. Parser-level failures (unknown flag, missing arg) also honor this contract when --json is anywhere in argv (code BAD_ARGUMENT, exit 3).',
      },
      statuses: { generate_edit_upscale_update: 'success | error', auth: 'ok | degraded | none', skill_install: 'success | partial | error' },
    },
    determinism: 'None of the routed models supports a seed parameter — identical prompts produce different images. Do not build workflows that assume reproducibility.',
    install: 'npm install -g nanaban (or: brew install paperfoot/tap/nanaban)',
    repository: 'https://github.com/paperfoot/nanaban-cli',
  };

  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}
