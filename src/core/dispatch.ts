import {
  detectAuth,
  resolveRoute,
  routesForModel,
  needsForModel,
  makeGeminiClient,
  type AuthState,
  type ResolvedRoute,
} from './auth.js';
import { resolveModel, type ModelInfo, type TransportId } from './models.js';
import { generateViaGemini } from './transport-gemini.js';
import { generateViaOpenRouter } from './transport-openrouter.js';
import { generateViaCodexOAuth } from './transport-codex-oauth.js';
import { parseAspectRatio, parseImageSize, checkCapabilities } from './aspect.js';
import { NB2Error, normalizeError, isTransient } from '../lib/errors.js';
import type { ImageRequest, ImageResult, GenerationMode } from './types.js';
import type { ReferenceImage } from './reference.js';

export interface DispatchOptions {
  prompt: string;
  mode: GenerationMode;
  modelName?: string;
  pro?: boolean;
  via?: string;
  aspect?: string;
  size?: string;
  negativePrompt?: string;
  referenceImages?: ReferenceImage[];
  basePath?: string;
}

export interface DispatchResult extends ImageResult {
  model: ModelInfo;
  authMethod: string;
  fallbacks?: { transport: TransportId; code: string; message: string }[];
}

function pickModel(opts: DispatchOptions, auth: AuthState): ModelInfo {
  let name = opts.modelName;
  if (!name) {
    // Only auto-select gpt-image-2 when the user hasn't pinned a non-Codex transport.
    // `--via openrouter` on a machine with Codex auth should still route nb2 through
    // OpenRouter, not fail because the auto-picked default model has no openrouter id.
    const viaForcesNonCodex =
      opts.via !== undefined &&
      opts.via !== 'codex-oauth' &&
      opts.via !== 'codex' &&
      opts.via !== 'plus';

    if (opts.pro) {
      name = 'nb2-pro';
    } else if (auth.codex && !viaForcesNonCodex) {
      name = 'gpt-image-2';
    } else {
      name = 'nb2';
    }
  }

  const model = resolveModel(name);
  if (!model) {
    throw new NB2Error('MODEL_NOT_FOUND', `Unknown model "${name}". Run \`nanaban agent-info\` to list available models.`);
  }
  return model;
}

function parseTransport(via: string | undefined): TransportId | undefined {
  if (!via) return undefined;
  if (via === 'gemini-direct' || via === 'openrouter' || via === 'codex-oauth') return via;
  if (via === 'gemini' || via === 'google') return 'gemini-direct';
  if (via === 'or') return 'openrouter';
  if (via === 'codex' || via === 'plus') return 'codex-oauth';
  throw new NB2Error('CAPABILITY_UNSUPPORTED', `Unknown transport "${via}". Use one of: gemini-direct, openrouter, codex-oauth`);
}

function noRoutesError(model: ModelInfo, auth: AuthState): NB2Error {
  const keysConfigured: string[] = [];
  if (auth.gemini) keysConfigured.push('Gemini');
  if (auth.openRouter) keysConfigured.push('OpenRouter');
  if (auth.codex) keysConfigured.push('Codex OAuth');

  const needs = needsForModel(model);

  if (keysConfigured.length === 0) {
    const onlyCodex = Object.keys(model.ids).length === 1 && !!model.ids['codex-oauth'];
    const hint = onlyCodex
      ? 'Quick fix: run `codex login` (free via ChatGPT Plus/Pro). This model is only reachable via the Codex bridge.'
      : model.ids['codex-oauth']
        ? 'Quick fix: run `codex login` (free via ChatGPT Plus/Pro), or set OPENROUTER_API_KEY.'
        : 'Quick fix: run `nanaban auth set-openrouter <key>` (one key reaches every OR-routed model), or set OPENROUTER_API_KEY / GEMINI_API_KEY.';
    return new NB2Error(
      'AUTH_MISSING',
      `No authentication configured. ${model.display} needs one of ${needs.join(' or ')}. ${hint}`,
    );
  }

  // Key exists but not for this model (e.g. only Gemini key for GPT-5, or no Codex auth for gpt-image-2).
  return new NB2Error(
    'TRANSPORT_UNAVAILABLE',
    `${model.display} cannot be reached with currently-configured auth (${keysConfigured.join(', ')}). ` +
      `This model needs ${needs.join(' or ')}.`,
  );
}

async function runRoute(
  route: ResolvedRoute,
  auth: AuthState,
  request: ImageRequest,
  basePath?: string,
): Promise<ImageResult> {
  if (route.transport === 'gemini-direct') {
    const client = makeGeminiClient(auth);
    return generateViaGemini(client, route.modelId, request, basePath);
  }
  if (route.transport === 'codex-oauth') {
    return generateViaCodexOAuth(
      { accessToken: route.codexToken!, accountId: route.codexAccountId! },
      route.modelId,
      request,
      basePath,
    );
  }
  return generateViaOpenRouter(route.authKey!, route.modelId, request, basePath);
}

export async function dispatch(opts: DispatchOptions): Promise<DispatchResult> {
  const auth = await detectAuth();
  const model = pickModel(opts, auth);
  const aspectRatio = parseAspectRatio(opts.aspect || '1:1');
  const imageSize = parseImageSize(opts.size || '1K');
  checkCapabilities(model, aspectRatio, imageSize);

  if (opts.mode === 'edit' && !model.caps.edit) {
    throw new NB2Error('CAPABILITY_UNSUPPORTED', `${model.display} does not support image editing`);
  }
  if (opts.referenceImages && opts.referenceImages.length > model.caps.maxRefImages) {
    throw new NB2Error(
      'CAPABILITY_UNSUPPORTED',
      `${model.display} accepts at most ${model.caps.maxRefImages} reference image(s)`,
    );
  }

  const forced = parseTransport(opts.via);

  const request: ImageRequest = {
    mode: opts.mode,
    prompt: opts.prompt,
    negativePrompt: opts.negativePrompt,
    aspectRatio,
    imageSize,
    referenceImages: opts.referenceImages,
  };

  // Explicit --via: one shot, no fallback. Caller asked for this specific route.
  if (forced) {
    const route = resolveRoute(model, auth, forced);
    const result = await runRoute(route, auth, request, opts.basePath);
    return { ...result, model, authMethod: describeAuth(route.transport, auth) };
  }

  // Auto routing: try preferred transport, fall back on transient failures.
  const routes = routesForModel(model, auth);
  if (routes.length === 0) throw noRoutesError(model, auth);

  const fallbacks: { transport: TransportId; code: string; message: string }[] = [];
  let lastErr: NB2Error | undefined;

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    try {
      const result = await runRoute(route, auth, request, opts.basePath);
      return { ...result, model, authMethod: describeAuth(route.transport, auth), fallbacks: fallbacks.length ? fallbacks : undefined };
    } catch (err) {
      const nerr = normalizeError(err);
      const isLast = i === routes.length - 1;
      if (isLast || !isTransient(nerr)) {
        // No more routes to try, or error isn't worth retrying on another provider.
        if (fallbacks.length > 0) {
          const chain = fallbacks.map(f => `${f.transport}:${f.code}`).join(' → ');
          throw new NB2Error(
            nerr.code,
            `${nerr.message} (tried ${chain} → ${route.transport}:${nerr.code})`,
          );
        }
        throw nerr;
      }
      fallbacks.push({ transport: route.transport, code: nerr.code, message: nerr.message });
      lastErr = nerr;
    }
  }

  // Unreachable — loop above always returns or throws.
  throw lastErr ?? new NB2Error('GENERATION_FAILED', 'No route succeeded');
}

function describeAuth(transport: TransportId, auth: AuthState): string {
  if (transport === 'gemini-direct' && auth.gemini) {
    const a = auth.gemini;
    return `gemini-direct via ${a.type === 'env' ? a.name : a.type === 'config' ? a.path : a.path}`;
  }
  if (transport === 'openrouter' && auth.openRouter) {
    const a = auth.openRouter;
    return `openrouter via ${a.type === 'env' ? a.name : a.path}`;
  }
  if (transport === 'codex-oauth' && auth.codex) {
    return `codex-oauth via ${auth.codex.path}`;
  }
  return transport;
}
