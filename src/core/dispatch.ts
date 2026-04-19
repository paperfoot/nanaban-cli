import { detectAuth, resolveRoute, makeGeminiClient, transportAvailable, type AuthState, type ResolvedRoute } from './auth.js';
import { resolveModel, type ModelInfo, type TransportId, TRANSPORT_PREFERENCE } from './models.js';
import { generateViaGemini } from './transport-gemini.js';
import { generateViaOpenRouter } from './transport-openrouter.js';
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

function pickModel(opts: DispatchOptions): ModelInfo {
  const name = opts.modelName ?? (opts.pro ? 'nb2-pro' : 'nb2');
  const model = resolveModel(name);
  if (!model) {
    throw new NB2Error('MODEL_NOT_FOUND', `Unknown model "${name}". Run \`nanaban agent-info\` to list available models.`);
  }
  return model;
}

function parseTransport(via: string | undefined): TransportId | undefined {
  if (!via) return undefined;
  if (via === 'gemini-direct' || via === 'openrouter') return via;
  if (via === 'gemini' || via === 'google') return 'gemini-direct';
  if (via === 'or') return 'openrouter';
  throw new NB2Error('CAPABILITY_UNSUPPORTED', `Unknown transport "${via}". Use one of: gemini-direct, openrouter`);
}

function buildRoute(model: ModelInfo, auth: AuthState, t: TransportId): ResolvedRoute | null {
  const modelId = model.ids[t];
  if (!modelId) return null;
  if (!transportAvailable(t, auth)) return null;
  if (t === 'gemini-direct') {
    const g = auth.gemini!;
    if (g.type === 'oauth') return { transport: t, modelId, oauthClient: g.client };
    return { transport: t, modelId, authKey: g.key };
  }
  return { transport: t, modelId, authKey: auth.openRouter!.key };
}

function routesForModel(model: ModelInfo, auth: AuthState): ResolvedRoute[] {
  const routes: ResolvedRoute[] = [];
  for (const t of TRANSPORT_PREFERENCE) {
    const r = buildRoute(model, auth, t);
    if (r) routes.push(r);
  }
  return routes;
}

function noRoutesError(model: ModelInfo, auth: AuthState): NB2Error {
  const keysConfigured: string[] = [];
  if (auth.gemini) keysConfigured.push('Gemini');
  if (auth.openRouter) keysConfigured.push('OpenRouter');

  const needs = Object.keys(model.ids).map(t =>
    t === 'gemini-direct' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY',
  );

  if (keysConfigured.length === 0) {
    return new NB2Error(
      'AUTH_MISSING',
      `No authentication configured. ${model.display} needs one of ${needs.join(' or ')}. ` +
        `Quick fix: run \`nanaban auth set-openrouter <key>\` (one key reaches every model), ` +
        `or set OPENROUTER_API_KEY / GEMINI_API_KEY in the environment.`,
    );
  }

  // Key exists but not for this model (e.g. only Gemini key for GPT-5).
  return new NB2Error(
    'TRANSPORT_UNAVAILABLE',
    `${model.display} cannot be reached with currently-configured auth (${keysConfigured.join(', ')}). ` +
      `This model needs ${needs.join(' or ')}. Run \`nanaban auth set-openrouter <key>\` to enable it.`,
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
  return generateViaOpenRouter(route.authKey!, route.modelId, request, basePath);
}

export async function dispatch(opts: DispatchOptions): Promise<DispatchResult> {
  const model = pickModel(opts);
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

  const auth = await detectAuth();
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
  return transport;
}
