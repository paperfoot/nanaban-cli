import type { AspectRatio, ImageSize } from './types.js';

export type Family = 'gemini' | 'openai';
export type TransportId = 'gemini-direct' | 'openrouter';

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
  costPerImageUsd: number;
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
      'gemini-direct': 'gemini-3.1-flash-image-preview',
      'openrouter': 'google/gemini-3.1-flash-image-preview',
    },
    aliases: ['nb2', 'nano-banana-2', 'flash'],
    caps: {
      aspectRatios: NB2_EXTENDED_RATIOS,
      sizes: ['0.5K', '1K', '2K', '4K'],
      maxRefImages: 4,
      edit: true,
      negativePrompt: true,
    },
    costPerImageUsd: 0.067,
  },
  {
    id: 'nb2-pro',
    display: 'Nano Banana Pro',
    family: 'gemini',
    ids: {
      'gemini-direct': 'gemini-3-pro-image-preview',
      'openrouter': 'google/gemini-3-pro-image-preview',
    },
    aliases: ['pro', 'nb2-pro', 'nano-banana-pro'],
    caps: {
      aspectRatios: STD_RATIOS,
      sizes: ['1K', '2K', '4K'],
      maxRefImages: 4,
      edit: true,
      negativePrompt: true,
    },
    costPerImageUsd: 0.136,
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

export const TRANSPORT_PREFERENCE: TransportId[] = ['openrouter', 'gemini-direct'];
