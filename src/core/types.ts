import type { ReferenceImage } from './reference.js';

export type AspectRatio =
  | '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4'
  | '9:16' | '16:9' | '21:9'
  | '1:4' | '4:1' | '1:8' | '8:1';

export type ImageSize = '0.5K' | '1K' | '2K' | '4K';

export type Quality = 'low' | 'medium' | 'high';

export type GenerationMode = 'generate' | 'edit';

export interface ImageRequest {
  mode: GenerationMode;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  quality?: Quality;
  referenceImages?: ReferenceImage[];
  /**
   * True when the caller did not ask for a specific size, so a route with a
   * fixed pixel budget is still an acceptable answer.
   */
  sizeIsImplicit?: boolean;
}

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  modelId: string;
  transport: 'gemini-direct' | 'openrouter' | 'codex-oauth';
  durationMs: number;
  costUsd?: number;
}
