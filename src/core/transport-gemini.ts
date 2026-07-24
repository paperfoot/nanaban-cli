import type { GoogleGenAI } from '@google/genai';
import { loadReferenceImage } from './reference.js';
import { NB2Error } from '../lib/errors.js';
import { inspectImage } from '../lib/image-meta.js';
import type { ImageRequest, ImageResult } from './types.js';

// Gemini's own block/finish signals for safety filtering. Surfacing these as
// CONTENT_BLOCKED (non-retryable, exit 3) stops agents from retry-looping a
// prompt that will be rejected identically every time.
const BLOCK_REASONS = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'OTHER']);

export async function generateViaGemini(
  client: GoogleGenAI,
  modelId: string,
  request: ImageRequest,
  basePath?: string,
): Promise<ImageResult> {
  const aspectRatio = request.aspectRatio || '1:1';
  const imageSize = request.imageSize || '1K';

  const parts: any[] = [];

  if (request.referenceImages?.length) {
    for (const ref of request.referenceImages) {
      const { mimeType, data } = await loadReferenceImage(ref, basePath);
      parts.push({ inlineData: { mimeType, data } });
    }
  }

  let prompt = request.prompt;
  if (request.negativePrompt) prompt += `\n\nAvoid: ${request.negativePrompt}`;
  parts.push({ text: prompt });

  const start = Date.now();
  const response = await client.models.generateContent({
    model: modelId,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['IMAGE', 'TEXT'],
      // The API only honors aspect/size through imageConfig — prompt prose is
      // best-effort at most, and --size was previously dropped entirely.
      //
      // No output-format control exists here, deliberately not attempted: Gemini
      // returns baseline JPEG and ONLY JPEG. Verified 2026-07-24 — imageConfig
      // rejects every mime field name ("Cannot find field"), and the newer
      // Interactions API answers `response_format.mime_type: image/png` with
      // "Supported values: 'image/jpeg'". So Gemini output carries JPEG
      // compression by nature; that is a provider limit, not a nanaban one.
      // Callers who need lossless pixels should use gpt-image-2, which emits PNG.
      imageConfig: { aspectRatio, imageSize },
    },
  });

  const blockReason = (response as any)?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new NB2Error('CONTENT_BLOCKED', `Gemini blocked the prompt (${blockReason}). Reword and try again.`);
  }

  const candidate = response?.candidates?.[0];
  if (!candidate?.content?.parts) {
    const finish = (candidate as any)?.finishReason;
    if (finish && BLOCK_REASONS.has(finish)) {
      throw new NB2Error('CONTENT_BLOCKED', `Gemini blocked the generation (${finish}). Reword and try again.`);
    }
    throw new NB2Error('GENERATION_FAILED', 'No content returned from Gemini');
  }

  // Gemini 3 image models can emit interim "thought" images before the final
  // render — take the LAST non-thought inline image, not the first part.
  let buffer: Buffer | null = null;
  let mimeType = 'image/png';
  for (const part of candidate.content.parts) {
    if ((part as any).thought) continue;
    if (part.inlineData?.data) {
      mimeType = part.inlineData.mimeType || mimeType;
      buffer = Buffer.from(part.inlineData.data, 'base64');
    }
  }
  if (!buffer) {
    const finish = (candidate as any)?.finishReason;
    if (finish && BLOCK_REASONS.has(finish)) {
      throw new NB2Error('CONTENT_BLOCKED', `Gemini blocked the generation (${finish}). Reword and try again.`);
    }
    throw new NB2Error('GENERATION_FAILED', 'No image data returned from Gemini');
  }

  const meta = inspectImage(buffer);
  return {
    buffer,
    mimeType: meta.mimeType || mimeType,
    width: meta.width,
    height: meta.height,
    modelId,
    transport: 'gemini-direct',
    durationMs: Date.now() - start,
  };
}
