import {
  detectAuth,
  buildRoute,
  needsForTransport,
  makeGeminiClient,
  type AuthState,
  type ResolvedRoute,
} from './auth.js';
import { MODELS, resolveModel, TRANSPORT_PREFERENCE, type ModelInfo, type TransportId } from './models.js';
import { generateViaGemini } from './transport-gemini.js';
import { generateViaOpenRouter } from './transport-openrouter.js';
import { generateViaCodexOAuth } from './transport-codex-oauth.js';
import path from 'path';
import fs from 'fs/promises';
import {
  parseAspectRatio,
  parseImageSize,
  parseQuality,
  routeRejection,
  routeScore,
  type RouteRequirement,
} from './aspect.js';
import { NB2Error, normalizeError, isTransient } from '../lib/errors.js';
import { inspectImage } from '../lib/image-meta.js';
import type { ImageRequest, ImageResult, GenerationMode, AspectRatio } from './types.js';
import type { ReferenceImage } from './reference.js';

export interface DispatchOptions {
  prompt: string;
  mode: GenerationMode;
  modelName?: string;
  via?: string;
  aspect?: string;
  size?: string;
  quality?: string;
  negativePrompt?: string;
  referenceImages?: ReferenceImage[];
  basePath?: string;
}

export interface DispatchResult extends ImageResult {
  model: ModelInfo;
  authMethod: string;
  /** True when costUsd is the route's estimate rather than a provider figure. */
  costEstimated: boolean;
  /** How faithfully the delivered frame matches what was asked for. */
  aspectFulfillment: 'exact' | 'approximate';
  warnings: string[];
  fallbacks?: { transport: TransportId; code: string; message: string }[];
}

/** A model+transport pair that could serve the request, with its ranking. */
interface Candidate {
  model: ModelInfo;
  route: ResolvedRoute;
  score: number;
}

/** A route that could have served the request but has no credentials. */
interface Locked {
  model: ModelInfo;
  transport: TransportId;
}

function parseTransport(via: string | undefined): TransportId | undefined {
  if (!via) return undefined;
  if (via === 'gemini-direct' || via === 'openrouter' || via === 'codex-oauth') return via;
  if (via === 'gemini' || via === 'google') return 'gemini-direct';
  if (via === 'or') return 'openrouter';
  if (via === 'codex' || via === 'plus' || via === 'chatgpt') return 'codex-oauth';
  throw new NB2Error(
    'BAD_ARGUMENT',
    `Unknown transport "${via}". Use one of: gemini-direct, openrouter, codex-oauth`,
  );
}

// For `edit` with no explicit --ar: match the source image instead of silently
// forcing 1:1 (which cropped every non-square input to a square). The candidate
// ratios are the union across all models — snapping to one model's stale list
// used to steer a 16:9 source toward 3:2.
const ALL_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

async function inferSourceAspect(ref: ReferenceImage, basePath?: string): Promise<AspectRatio | null> {
  if (ref.source !== 'file' || !ref.path) return null;
  try {
    const filePath = basePath ? path.resolve(basePath, ref.path) : path.resolve(ref.path);
    const meta = inspectImage(await fs.readFile(filePath));
    if (!meta.width || !meta.height) return null;
    const actual = meta.width / meta.height;
    let best: AspectRatio | null = null;
    let bestDist = Infinity;
    for (const r of ALL_RATIOS) {
      const [rw, rh] = r.split(':').map(Number);
      const dist = Math.abs(Math.log(actual / (rw / rh)));
      if (dist < bestDist) {
        bestDist = dist;
        best = r;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Plan the route. Resolution, aspect, and quality are HARD constraints that
 * select the model — never validated against a model that was already chosen.
 * That inversion is the whole v6 fix: `--size 4k` used to pick the default
 * model and then fail it, instead of picking a model that can deliver 4K.
 */
function plan(
  opts: DispatchOptions,
  auth: AuthState,
  req: RouteRequirement,
  forced: TransportId | undefined,
  aspectMatters: boolean,
): { candidates: Candidate[]; locked: Locked[]; rejected: string[] } {
  const pinned = opts.modelName ? resolveModel(opts.modelName) : null;
  if (opts.modelName && !pinned) {
    throw new NB2Error(
      'MODEL_NOT_FOUND',
      `Unknown model "${opts.modelName}". Available: ${MODELS.map(m => m.id).join(', ')} ` +
        '(aliases are flexible — `gpt`, `nano banana`, `lite`, `pro` all work). Run `nanaban agent-info` for the full list.',
    );
  }

  const pool = pinned ? [pinned] : MODELS;
  const candidates: Candidate[] = [];
  const locked: Locked[] = [];
  const rejected: string[] = [];

  for (const model of pool) {
    if (forced && !model.routes[forced]) {
      rejected.push(`${model.id} has no ${forced} route`);
      continue;
    }
    for (const t of TRANSPORT_PREFERENCE) {
      const caps = model.routes[t];
      if (!caps) continue;
      if (forced && t !== forced) continue;

      const why = routeRejection(caps, req);
      if (why) {
        rejected.push(`${model.id}/${t} ${why}`);
        continue;
      }

      // Capable, but is it reachable? A present-but-expired Codex token can only
      // burn time on a guaranteed 401, so treat it as locked, not available.
      const usable = t !== 'codex-oauth' || !auth.codex?.expired;
      const route = usable ? buildRoute(model, auth, t, req.size) : null;
      if (!route) {
        locked.push({ model, transport: t });
        continue;
      }
      candidates.push({ model, route, score: routeScore(caps, aspectMatters) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { candidates, locked, rejected };
}

function noRouteError(
  req: RouteRequirement,
  locked: Locked[],
  rejected: string[],
  pinnedName?: string,
): NB2Error {
  const want = `${req.aspect}${req.sizeIsExplicit ? ` at ${req.size}` : ''}${req.quality ? ` quality=${req.quality}` : ''}`;

  if (locked.length > 0) {
    const unlocks = [...new Set(locked.map(l => `${needsForTransport(l.transport)} → --model ${l.model.id}`))];
    return new NB2Error(
      'AUTH_MISSING',
      `No configured route can deliver ${want}. ` +
        `Add credentials to unlock one of: ${unlocks.join('; ')}.` +
        (rejected.length ? ` Rejected: ${rejected.slice(0, 4).join('; ')}.` : ''),
    );
  }

  // Nothing was even capable — this is a capability problem, not an auth one.
  return new NB2Error(
    'CAPABILITY_UNSUPPORTED',
    pinnedName
      ? `${pinnedName} cannot deliver ${want}. ${rejected.slice(0, 3).join('; ')}.`
      : `No model can deliver ${want}. ${rejected.slice(0, 4).join('; ')}.`,
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
  // Validate file references before anything else — a missing file must be
  // IMAGE_NOT_FOUND (exit 3) on every machine, not AUTH_MISSING (exit 2) on
  // hosts that happen to have no credentials configured.
  for (const ref of opts.referenceImages ?? []) {
    if (ref.source === 'file' && ref.path) {
      const p = opts.basePath ? path.resolve(opts.basePath, ref.path) : path.resolve(ref.path);
      try {
        await fs.access(p);
      } catch {
        throw new NB2Error('IMAGE_NOT_FOUND', `Reference image not found: ${p}`);
      }
    }
  }

  const auth = await detectAuth();
  const forced = parseTransport(opts.via);

  const sizeIsExplicit = opts.size !== undefined;
  const imageSize = parseImageSize(opts.size ?? '1K');
  const quality = opts.quality ? parseQuality(opts.quality) : undefined;

  let aspectRatio = opts.aspect ? parseAspectRatio(opts.aspect) : undefined;
  if (!aspectRatio && opts.mode === 'edit' && opts.referenceImages?.[0]) {
    aspectRatio = (await inferSourceAspect(opts.referenceImages[0], opts.basePath)) ?? undefined;
  }
  aspectRatio ??= '1:1';

  const req: RouteRequirement = {
    aspect: aspectRatio,
    size: imageSize,
    sizeIsExplicit,
    quality,
    mode: opts.mode,
    referenceCount: opts.referenceImages?.length ?? 0,
  };

  // A prompt-steered frame only matters when the caller actually named a
  // non-square ratio; for an unspecified/square request the free route is just
  // as good an answer.
  const aspectMatters = opts.aspect !== undefined && aspectRatio !== '1:1';
  const { candidates, locked, rejected } = plan(opts, auth, req, forced, aspectMatters);
  if (candidates.length === 0) {
    if (forced && auth.codex?.expired && forced === 'codex-oauth') {
      throw new NB2Error(
        'AUTH_EXPIRED',
        'The ChatGPT OAuth token in ~/.codex/auth.json is expired — run `codex login` to refresh it.',
      );
    }
    throw noRouteError(req, locked, rejected, opts.modelName);
  }

  const request: ImageRequest = {
    mode: opts.mode,
    prompt: opts.prompt,
    negativePrompt: opts.negativePrompt,
    aspectRatio,
    imageSize,
    quality,
    sizeIsImplicit: !sizeIsExplicit,
    referenceImages: opts.referenceImages,
  };

  // Explicit --via: one shot, no cross-transport fallback. The caller pinned it.
  const chain = forced ? candidates.slice(0, 1) : candidates;
  const fallbacks: { transport: TransportId; code: string; message: string }[] = [];
  let lastErr: NB2Error | undefined;

  for (let i = 0; i < chain.length; i++) {
    const { model, route } = chain[i];
    try {
      const result = await runRoute(route, auth, request, opts.basePath);
      const warnings: string[] = [];
      if (route.caps.fixedPixelBudget) {
        warnings.push(
          `${route.transport} returns a fixed ~${(route.caps.fixedPixelBudget / 1e6).toFixed(2)}MP budget and ` +
            `forces quality=${route.caps.forcedQuality ?? 'low'}; aspect is prompt-steered and approximate. ` +
            'Use --size 2k/4k to route to an exact-resolution provider.',
        );
      }
      if (fallbacks.length) {
        warnings.push(`fell back after ${fallbacks.map(f => `${f.transport}:${f.code}`).join(' → ')}`);
      }
      // Only OpenRouter returns a real figure. Rather than report nothing (which
      // reads as free) fall back to the route's estimate and flag it as such.
      const costEstimated = result.costUsd === undefined && route.caps.billing === 'metered';
      return {
        ...result,
        costUsd: result.costUsd ?? (costEstimated ? route.caps.costPerImageUsd : result.costUsd),
        costEstimated,
        model,
        authMethod: describeAuth(route.transport, auth),
        aspectFulfillment: route.caps.aspectExact ? 'exact' : 'approximate',
        warnings,
        fallbacks: fallbacks.length ? fallbacks : undefined,
      };
    } catch (err) {
      const nerr = normalizeError(err);
      const isLast = i === chain.length - 1;
      if (isLast || !isTransient(nerr)) {
        if (fallbacks.length > 0) {
          const trail = fallbacks.map(f => `${f.transport}:${f.code}`).join(' → ');
          throw new NB2Error(nerr.code, `${nerr.message} (tried ${trail} → ${route.transport}:${nerr.code})`);
        }
        throw nerr;
      }
      fallbacks.push({ transport: route.transport, code: nerr.code, message: nerr.message });
      lastErr = nerr;
    }
  }

  throw lastErr ?? new NB2Error('GENERATION_FAILED', 'No route succeeded');
}

function describeAuth(transport: TransportId, auth: AuthState): string {
  if (transport === 'gemini-direct' && auth.gemini) {
    const a = auth.gemini;
    return `gemini-direct via ${a.type === 'env' ? a.name : a.path}`;
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
