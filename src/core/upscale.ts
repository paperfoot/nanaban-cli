import fs from 'fs/promises';
import path from 'path';
import { NB2Error } from '../lib/errors.js';
import { inspectImage } from '../lib/image-meta.js';
import { readConfig } from '../lib/config.js';
import { dispatch } from './dispatch.js';
import { resolveModel } from './models.js';
import { upscaleViaReplicate, REPLICATE_MODEL, REPLICATE_EST_COST_USD } from './transport-replicate.js';
import { upscaleViaRecraft, RECRAFT_MODEL, RECRAFT_EST_COST_USD } from './transport-recraft.js';
import type { ImageSize } from './types.js';

export type UpscaleEngine = 'real-esrgan' | 'crisp' | 'rerender';

export interface UpscaleOptions {
  imagePath: string;
  scale: number; // 2 | 4
  engine: 'auto' | UpscaleEngine;
  modelName?: string; // rerender only
  faceEnhance: boolean;
  basePath?: string;
}

export interface UpscaleOutcome {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
  engine: UpscaleEngine;
  /** super_resolution = content-preserving best-effort; generative_rerender = pixels re-synthesized. */
  method: 'super_resolution' | 'generative_rerender';
  contentPreservation: 'best_effort' | 'not_preserved';
  model: string;
  providerModel: string;
  transport: string;
  durationMs: number;
  costUsd?: number;
  warnings: string[];
}

interface EngineKeys {
  replicate?: string;
  recraft?: string;
}

async function engineKeys(): Promise<EngineKeys> {
  const config = await readConfig();
  return {
    replicate: process.env.REPLICATE_API_TOKEN || config.replicateKey,
    recraft: process.env.RECRAFT_API_TOKEN || config.recraftKey,
  };
}

const SIZE_BASE: Record<ImageSize, number> = { '0.5K': 512, '1K': 1024, '2K': 2048, '4K': 4096 };

// Generative fallback: re-render the image at a higher resolution through an
// existing generation transport. Honest but different in kind — the model
// re-synthesizes every pixel, so content can drift. Always labeled as such.
const RERENDER_PROMPT =
  'Upscale this image to a higher resolution. Reproduce it EXACTLY: identical composition, subjects, ' +
  'colors, lighting, text, and style. Only add fine detail and sharpness. Do not add, remove, move, or ' +
  'reinterpret any element.';

async function rerenderUpscale(
  opts: UpscaleOptions,
  input: { width: number; height: number },
  warnings: string[],
): Promise<UpscaleOutcome> {
  // nb2 reaches 4K on both gemini-direct and OpenRouter. The old default was
  // nb2-pro, which needed a Gemini key and whose OpenRouter route silently
  // downgraded — so the no-key fallback path failed outright.
  const modelName = opts.modelName ?? 'nb2';
  const model = resolveModel(modelName);
  if (!model) throw new NB2Error('MODEL_NOT_FOUND', `Unknown rerender model "${modelName}"`);
  const editable = Object.values(model.routes).some(r => r.edit);
  if (!editable) throw new NB2Error('CAPABILITY_UNSUPPORTED', `${model.display} cannot take an input image`);

  // Closest supported size to input-long-edge x scale (by log-ratio). Closest
  // beats smallest-that-covers: a 1254px input at 2x used to select 4K — a
  // 3.3x overshoot that costs more and that some routes reject outright
  // (OpenRouter's stable flash id 400s on 4K; live-observed 2026-07-21).
  const inputEdge = Math.max(input.width, input.height);
  const targetEdge = inputEdge * opts.scale;
  // Union of every size any route of this model can serve — the planner picks
  // the route that can actually deliver the one we choose.
  const all = new Set<ImageSize>();
  for (const r of Object.values(model.routes)) for (const s of r.sizes) all.add(s);
  const supported = [...all].sort((a, b) => SIZE_BASE[a] - SIZE_BASE[b]);
  const size = supported.reduce((best, s) =>
    Math.abs(Math.log(SIZE_BASE[s] / targetEdge)) < Math.abs(Math.log(SIZE_BASE[best] / targetEdge)) ? s : best,
  );
  const actualScale = SIZE_BASE[size] / inputEdge;
  if (Math.abs(actualScale - opts.scale) > 0.25) {
    warnings.push(
      `${model.display} renders at fixed sizes — output is ${size} (${SIZE_BASE[size]}px long edge, ~${actualScale.toFixed(1)}x), not exactly ${opts.scale}x. Use --engine real-esrgan for exact scaling.`,
    );
  }

  const result = await dispatch({
    mode: 'edit',
    prompt: RERENDER_PROMPT,
    modelName: model.id,
    size,
    referenceImages: [{ source: 'file', path: opts.imagePath }],
    basePath: opts.basePath,
  });

  return {
    buffer: result.buffer,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    inputWidth: input.width,
    inputHeight: input.height,
    engine: 'rerender',
    method: 'generative_rerender',
    contentPreservation: 'not_preserved',
    model: result.model.id,
    providerModel: result.modelId,
    transport: result.transport,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    warnings: [...warnings, ...result.warnings],
  };
}

export async function dispatchUpscale(opts: UpscaleOptions): Promise<UpscaleOutcome> {
  if (opts.scale !== 2 && opts.scale !== 4) {
    throw new NB2Error('BAD_ARGUMENT', `--scale must be 2 or 4 (got ${opts.scale})`);
  }

  const resolved = opts.basePath ? path.resolve(opts.basePath, opts.imagePath) : path.resolve(opts.imagePath);
  let inputBuffer: Buffer;
  try {
    inputBuffer = await fs.readFile(resolved);
  } catch {
    throw new NB2Error('IMAGE_NOT_FOUND', `Image not found: ${resolved}`);
  }
  const inputMeta = inspectImage(inputBuffer);
  if (!inputMeta.mimeType) {
    throw new NB2Error('IMAGE_NOT_FOUND', `${resolved} is not a recognizable image (png/jpeg/webp/gif)`);
  }

  const keys = await engineKeys();
  const warnings: string[] = [];

  let engine: UpscaleEngine;
  if (opts.engine === 'auto') {
    if (keys.replicate) engine = 'real-esrgan';
    else if (keys.recraft) engine = 'crisp';
    else {
      engine = 'rerender';
      warnings.push(
        'No dedicated upscaler key found — used generative re-render (pixels are re-synthesized; content can drift). ' +
          'For true super-resolution set REPLICATE_API_TOKEN (Real-ESRGAN, ~$0.002/image) or RECRAFT_API_TOKEN (Crisp Upscale, ~$0.004/image).',
      );
    }
  } else {
    engine = opts.engine;
  }

  if (engine === 'real-esrgan') {
    if (!keys.replicate) {
      throw new NB2Error('AUTH_MISSING', 'real-esrgan needs REPLICATE_API_TOKEN (https://replicate.com/account/api-tokens).');
    }
    if (opts.faceEnhance) warnings.push('face-enhance (GFPGAN) can alter facial identity — verify the result.');
    const r = await upscaleViaReplicate(keys.replicate, inputBuffer, inputMeta.mimeType, opts.scale, opts.faceEnhance);
    const meta = inspectImage(r.buffer);
    return {
      buffer: r.buffer,
      mimeType: meta.mimeType || 'image/png',
      width: meta.width,
      height: meta.height,
      inputWidth: inputMeta.width,
      inputHeight: inputMeta.height,
      engine,
      method: 'super_resolution',
      contentPreservation: 'best_effort',
      model: 'real-esrgan',
      providerModel: REPLICATE_MODEL,
      transport: 'replicate',
      durationMs: r.durationMs,
      costUsd: REPLICATE_EST_COST_USD,
      warnings,
    };
  }

  if (engine === 'crisp') {
    if (!keys.recraft) {
      throw new NB2Error('AUTH_MISSING', 'crisp needs RECRAFT_API_TOKEN (https://www.recraft.ai — API settings).');
    }
    if (opts.faceEnhance) warnings.push('--face-enhance only applies to real-esrgan; ignored.');
    const r = await upscaleViaRecraft(keys.recraft, inputBuffer, inputMeta.mimeType);
    const meta = inspectImage(r.buffer);
    return {
      buffer: r.buffer,
      mimeType: meta.mimeType || 'image/png',
      width: meta.width,
      height: meta.height,
      inputWidth: inputMeta.width,
      inputHeight: inputMeta.height,
      engine,
      method: 'super_resolution',
      contentPreservation: 'best_effort',
      model: 'crisp-upscale',
      providerModel: RECRAFT_MODEL,
      transport: 'recraft',
      durationMs: r.durationMs,
      costUsd: RECRAFT_EST_COST_USD,
      warnings,
    };
  }

  if (opts.faceEnhance) warnings.push('--face-enhance only applies to real-esrgan; ignored.');
  return rerenderUpscale({ ...opts, imagePath: resolved }, { width: inputMeta.width, height: inputMeta.height }, warnings);
}
