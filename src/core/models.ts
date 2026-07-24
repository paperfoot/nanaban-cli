import type { AspectRatio, ImageSize, Quality } from './types.js';

export type Family = 'gemini' | 'openai';
export type TransportId = 'gemini-direct' | 'openrouter' | 'codex-oauth';

/**
 * Capabilities are a property of a ROUTE (model × transport), never of a model.
 * The same model behaves very differently depending on how it is reached — e.g.
 * Nano Banana renders true 4K on gemini-direct but only up to 2K from
 * OpenRouter's stable ids, and GPT Image 2 is flexible on a metered route but
 * locked to a fixed pixel budget on the free Codex bridge. Declaring one flat capability set
 * per model is what made `--size 4k` unreachable and made agents plan around
 * limits that did not exist.
 */
export interface RouteCaps {
  /** Provider-side model id for this route. */
  providerModel: string;
  /**
   * Per-size provider id override. OpenRouter serves 4K only from the `-preview`
   * ids; the stable ids hard-reject it (live-verified 2026-07-23).
   */
  providerModelBySize?: Partial<Record<ImageSize, string>>;
  aspectRatios: AspectRatio[];
  sizes: ImageSize[];
  maxRefImages: number;
  edit: boolean;
  /**
   * false when the route has no size/aspect parameter and the frame can only be
   * steered through prompt prose — the result is approximate, not guaranteed.
   */
  aspectExact: boolean;
  /**
   * Set when the route ignores the requested size and always returns roughly
   * this many pixels. Reshaping the frame redistributes the same budget.
   */
  fixedPixelBudget?: number;
  /** Set when the route pins quality regardless of what was asked for. */
  forcedQuality?: Quality;
  /** Quality tiers this route actually exposes. Omitted = model-defined. */
  quality?: Quality[];
  /** Estimated USD per image at 1K. 0 = billed to a subscription, not metered. */
  costPerImageUsd: number;
  billing: 'subscription_quota' | 'metered';
  lifecycle: 'stable' | 'preview';
  /** Honest caveats an agent must know before choosing this route. */
  notes?: string;
}

export interface ModelInfo {
  id: string;
  display: string;
  family: Family;
  /** Family aliases resolve version-agnostically — always to the newest member. */
  aliases: string[];
  routes: Partial<Record<TransportId, RouteCaps>>;
  notes?: string;
}

// The ten ratios Google documents for the Gemini 3 image models. The older
// 1:4 / 4:1 / 1:8 / 8:1 entries were never documented by any provider and are
// no longer advertised — an undocumented ratio that silently reframes is worse
// than a clean "unsupported" listing what does work.
const STD_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

// Live-measured 2026-07-23: the Codex bridge returns 1254x1254 (1,572,516 px)
// for every requested size, and the same budget reshaped (1672x941 = 1,573,352 px)
// when the prompt steers the frame. Encoded as a dated empirical invariant, not
// an OpenAI guarantee.
const CODEX_PIXEL_BUDGET = 1_572_516;

export const MODELS: ModelInfo[] = [
  {
    id: 'gpt-image-2',
    display: 'GPT Image 2',
    family: 'openai',
    // `gpt`, `gpt5`, `mini` etc. all land here on purpose: family aliases must
    // always resolve to the CURRENT model. Pointing `gpt` at a retired
    // GPT Image 1-era model is exactly the trap this table exists to prevent.
    aliases: [
      'gpt', 'gpt-image', 'gpt-image-2', 'gptimage', 'gi2', 'img2', 'images2', 'image2',
      'openai', 'chatgpt', 'gpt5', 'gpt-5-image', 'gpt5-mini', 'mini', 'gpt54', 'gpt-5.4-image-2',
    ],
    routes: {
      'codex-oauth': {
        providerModel: 'gpt-image-2',
        // Every standard ratio is reachable here — the bridge honours an explicit
        // aspect instruction in the prompt. It is approximate, not exact, but
        // refusing 16:9 outright (as v5 did) was simply wrong.
        aspectRatios: STD_RATIOS,
        sizes: ['1K'],
        maxRefImages: 16,
        edit: true,
        aspectExact: false,
        fixedPixelBudget: CODEX_PIXEL_BUDGET,
        forcedQuality: 'low',
        costPerImageUsd: 0,
        billing: 'subscription_quota',
        lifecycle: 'stable',
        notes:
          'Free via the ChatGPT subscription, but hard-capped: the bridge ignores the size parameter and ' +
          'always returns ~1.57 megapixels (1254x1254 square, or the same budget reshaped), and forces ' +
          'quality=low. Aspect ratio is steered through the prompt, so it is approximate. Verified 2026-07-23. ' +
          'Cannot produce 2K or 4K by any means — nanaban routes elsewhere for those.',
      },
      'openrouter': {
        // `openai/gpt-image-2` exists in OpenRouter's catalog but has NO image
        // endpoint — it 404s on every request. `openai/gpt-5.4-image-2` is the
        // working OpenRouter path to the GPT Image 2 stack (verified 2K 16:9 →
        // 2560x1440, 2026-07-23).
        providerModel: 'openai/gpt-5.4-image-2',
        aspectRatios: STD_RATIOS,
        sizes: ['1K', '2K'],
        maxRefImages: 16,
        edit: true,
        aspectExact: true,
        quality: ['low', 'medium', 'high'],
        costPerImageUsd: 0.257,
        billing: 'metered',
        lifecycle: 'stable',
        notes: 'Exact sizes and true 16:9, unlike the free Codex route — but metered.',
      },
    },
  },
  {
    id: 'nb2',
    display: 'Nano Banana 2',
    family: 'gemini',
    aliases: [
      'nb', 'nb2', 'nano', 'nanobanana', 'nano-banana', 'nano-banana-2', 'banana',
      'flash', 'full', 'nb-full', 'nanobananafull',
      // `pro` lands here too. Nano Banana Pro is Gemini 3 Pro Image — a whole
      // generation behind this model's Gemini 3.1, and it was removed in v7.
      // "pro" means "the best current Nano Banana", so it points at whatever
      // that is today; repoint it if Google ships a 3.1 Pro.
      'pro', 'nb-pro', 'nb2-pro', 'nanobananapro', 'nano-banana-pro',
    ],
    routes: {
      'gemini-direct': {
        providerModel: 'gemini-3.1-flash-image',
        aspectRatios: STD_RATIOS,
        sizes: ['0.5K', '1K', '2K', '4K'],
        maxRefImages: 14,
        edit: true,
        aspectExact: true,
        costPerImageUsd: 0.067,
        billing: 'metered',
        lifecycle: 'stable',
        notes: 'True 4K verified 2026-07-23 (16:9 → 5504x3072).',
      },
      'openrouter': {
        providerModel: 'google/gemini-3.1-flash-image',
        // The stable id hard-rejects 4K ("Only the following models support 4K
        // image generation: ...-preview-..."). The preview id serves it.
        providerModelBySize: { '4K': 'google/gemini-3.1-flash-image-preview' },
        aspectRatios: STD_RATIOS,
        sizes: ['1K', '2K', '4K'],
        maxRefImages: 14,
        edit: true,
        aspectExact: true,
        costPerImageUsd: 0.1,
        billing: 'metered',
        lifecycle: 'stable',
        notes: '4K is served by the -preview provider id; 1K/2K by the stable id. Both verified 2026-07-23.',
      },
    },
  },
  {
    id: 'nb-lite',
    display: 'Nano Banana 2 Lite',
    family: 'gemini',
    aliases: ['lite', 'nb-lite', 'nb2-lite', 'nanobananalite', 'nano-banana-lite', 'flash-lite', 'flashlite'],
    routes: {
      'gemini-direct': {
        providerModel: 'gemini-3.1-flash-lite-image',
        aspectRatios: STD_RATIOS,
        sizes: ['1K'],
        // v5 declared 0 reference images and edit:false. Google's own reference
        // table gives Flash Lite "up to 14 images of objects with high-fidelity";
        // the real caveat is only that it is not OPTIMIZED for them.
        maxRefImages: 14,
        edit: true,
        aspectExact: true,
        costPerImageUsd: 0.034,
        billing: 'metered',
        lifecycle: 'stable',
      },
      'openrouter': {
        providerModel: 'google/gemini-3.1-flash-lite-image',
        aspectRatios: STD_RATIOS,
        sizes: ['1K'],
        maxRefImages: 14,
        edit: true,
        aspectExact: true,
        costPerImageUsd: 0.034,
        billing: 'metered',
        lifecycle: 'stable',
      },
    },
    notes:
      'Fastest and cheapest. 1K only. Accepts up to 14 object reference images but is not optimized for ' +
      'multiple references or multi-turn sequential editing — use nb2 for those.',
  },
];

/**
 * Normalize a user- or agent-supplied model name so spacing, casing, and
 * punctuation never matter: "GPT Image", "gpt-image", "gptimage" all match.
 */
export function normalizeModelKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MODEL_LOOKUP = new Map<string, ModelInfo>();
for (const m of MODELS) {
  MODEL_LOOKUP.set(normalizeModelKey(m.id), m);
  for (const a of m.aliases) MODEL_LOOKUP.set(normalizeModelKey(a), m);
}

export function resolveModel(name: string): ModelInfo | null {
  return MODEL_LOOKUP.get(normalizeModelKey(name)) || null;
}

export function listModelNames(): string[] {
  return MODELS.map(m => m.id);
}

/** Every accepted alias, for help text and the manifest. */
export function aliasesFor(model: ModelInfo): string[] {
  return model.aliases.filter(a => normalizeModelKey(a) !== normalizeModelKey(model.id));
}

/** The provider model id this route uses for a given output size. */
export function providerModelFor(caps: RouteCaps, size: ImageSize): string {
  return caps.providerModelBySize?.[size] ?? caps.providerModel;
}

/**
 * Route preference. gemini-direct comes FIRST: in v5 `openrouter` outranked it,
 * so every Gemini request went through the one provider that cannot serve 4K
 * (and that silently downgrades Pro). codex-oauth precedes openrouter because it
 * is free — but it is excluded up front for any request it cannot satisfy.
 */
export const TRANSPORT_PREFERENCE: TransportId[] = ['gemini-direct', 'codex-oauth', 'openrouter'];
