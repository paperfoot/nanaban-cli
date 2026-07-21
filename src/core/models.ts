import type { AspectRatio, ImageSize } from './types.js';

export type Family = 'gemini' | 'openai';
export type TransportId = 'gemini-direct' | 'openrouter' | 'codex-oauth';

export interface ModelCaps {
  aspectRatios: AspectRatio[];
  sizes: ImageSize[];
  maxRefImages: number;
  edit: boolean;
  negativePrompt: boolean;
}

export interface ModelInfo {
  id: string;
  display: string;
  family: Family;
  ids: Partial<Record<TransportId, string>>;
  aliases: string[];
  caps: ModelCaps;
  /** Estimated cost at 1K; Gemini pricing varies with output size. */
  costPerImageUsd: number;
  /** Honest caveats agents must know (bridge quirks, upcoming retirement). */
  notes?: string;
  deprecated?: boolean;
}

const STD_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const NB2_EXTENDED_RATIOS: AspectRatio[] = [...STD_RATIOS, '1:4', '4:1', '1:8', '8:1'];
const OPENAI_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2'];

export const MODELS: ModelInfo[] = [
  {
    id: 'nb2',
    display: 'Nano Banana 2',
    family: 'gemini',
    ids: {
      'gemini-direct': 'gemini-3.1-flash-image',
      'openrouter': 'google/gemini-3.1-flash-image',
    },
    aliases: ['nb2', 'nano-banana-2', 'flash'],
    caps: {
      aspectRatios: NB2_EXTENDED_RATIOS,
      sizes: ['0.5K', '1K', '2K', '4K'],
      maxRefImages: 14,
      edit: true,
      negativePrompt: true,
    },
    costPerImageUsd: 0.067,
  },
  {
    id: 'nb2-lite',
    display: 'Nano Banana 2 Lite',
    family: 'gemini',
    ids: {
      'gemini-direct': 'gemini-3.1-flash-lite-image',
      'openrouter': 'google/gemini-3.1-flash-lite-image',
    },
    aliases: ['nb2-lite', 'lite', 'nano-banana-2-lite', 'flash-lite'],
    caps: {
      aspectRatios: STD_RATIOS,
      sizes: ['1K'],
      // Google docs (2026-07): flash-lite is text-to-image only, no reference images.
      maxRefImages: 0,
      edit: false,
      negativePrompt: true,
    },
    costPerImageUsd: 0.034,
    notes: 'Text-to-image only per Google docs — no editing, no reference images.',
  },
  {
    id: 'nb2-pro',
    display: 'Nano Banana Pro',
    family: 'gemini',
    ids: {
      'gemini-direct': 'gemini-3-pro-image',
      'openrouter': 'google/gemini-3-pro-image',
    },
    aliases: ['pro', 'nb2-pro', 'nano-banana-pro'],
    caps: {
      aspectRatios: STD_RATIOS,
      sizes: ['1K', '2K', '4K'],
      maxRefImages: 14,
      edit: true,
      negativePrompt: true,
    },
    // Gemini pricing page (2026-07): $0.134 at 1K/2K, $0.24 at 4K.
    costPerImageUsd: 0.134,
  },
  {
    id: 'gpt5',
    display: 'GPT-5 Image',
    family: 'openai',
    ids: {
      'openrouter': 'openai/gpt-5-image',
    },
    aliases: ['gpt5', 'gpt-5-image', 'gpt'],
    caps: {
      aspectRatios: OPENAI_RATIOS,
      sizes: ['1K'],
      maxRefImages: 16,
      edit: true,
      negativePrompt: false,
    },
    costPerImageUsd: 0.193,
    deprecated: true,
    notes: 'Built on the GPT-5-chat + GPT Image 1 stack that OpenAI is retiring (components sunset from 2026-07-23). Prefer gpt54 or gpt-image-2.',
  },
  {
    id: 'gpt5-mini',
    display: 'GPT-5 Image Mini',
    family: 'openai',
    ids: {
      'openrouter': 'openai/gpt-5-image-mini',
    },
    aliases: ['gpt5-mini', 'gpt-5-mini', 'mini'],
    caps: {
      aspectRatios: OPENAI_RATIOS,
      sizes: ['1K'],
      maxRefImages: 16,
      edit: true,
      negativePrompt: false,
    },
    costPerImageUsd: 0.041,
    deprecated: true,
    notes: 'Built on the retiring GPT Image 1-mini stack (sunset 2026-12-01). Prefer gpt54 or gpt-image-2.',
  },
  {
    id: 'gpt54',
    display: 'GPT-5.4 Image 2',
    family: 'openai',
    ids: {
      'openrouter': 'openai/gpt-5.4-image-2',
    },
    aliases: ['gpt54', 'gpt-5.4-image-2', 'gpt5.4'],
    caps: {
      aspectRatios: OPENAI_RATIOS,
      sizes: ['1K'],
      maxRefImages: 16,
      edit: true,
      negativePrompt: false,
    },
    // Observed on OpenRouter (1K square generation).
    costPerImageUsd: 0.22,
  },
  {
    id: 'gpt-image-2',
    display: 'GPT Image 2',
    family: 'openai',
    ids: {
      'codex-oauth': 'gpt-image-2',
      // OpenRouter added openai/gpt-image-2 (2026) — a metered fallback so the
      // default model finally has a second route when the bridge is down.
      'openrouter': 'openai/gpt-image-2',
    },
    // Canonical id is `gpt-image-2`; `gi2` is a short alias; `img2`/`images2` match OpenAI's "ChatGPT Images 2.0" branding.
    aliases: ['gi2', 'gpt-image-2', 'img2', 'images2'],
    caps: {
      aspectRatios: OPENAI_RATIOS,
      sizes: ['1K'],
      // egaki-verified: the bridge accepts multiple reference images. Cap at 16 to match gpt5.
      maxRefImages: 16,
      edit: true,
      negativePrompt: false,
    },
    // $0 on the codex-oauth route (billed to the ChatGPT sub); metered when
    // the openrouter fallback route is used (envelope reports actual cost).
    costPerImageUsd: 0,
    notes: 'Via the Codex bridge the backend picks the output size (~1254px square observed regardless of the size parameter) and aspect ratio is steered through the prompt — approximate, not exact. The envelope always reports measured dimensions. For exact sizes use a Gemini model or the openrouter route.',
  },
];

const MODEL_LOOKUP = new Map<string, ModelInfo>();
for (const m of MODELS) {
  MODEL_LOOKUP.set(m.id, m);
  for (const a of m.aliases) MODEL_LOOKUP.set(a, m);
}

export function resolveModel(name: string): ModelInfo | null {
  return MODEL_LOOKUP.get(name.toLowerCase()) || null;
}

export function listModelNames(): string[] {
  return MODELS.map(m => m.id);
}

export const TRANSPORT_PREFERENCE: TransportId[] = ['codex-oauth', 'openrouter', 'gemini-direct'];
