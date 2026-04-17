import { loadReferenceImage } from './reference.js';
import { NB2Error } from '../lib/errors.js';
import type { ImageRequest, ImageResult } from './types.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function parsePngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    i += 2;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) };
    }
    const segLen = buf.readUInt16BE(i);
    i += segLen;
  }
  return null;
}

function parseDimensions(buf: Buffer, mime: string): { width: number; height: number } {
  const fn = mime.includes('jpeg') ? parseJpegDimensions : parsePngDimensions;
  return fn(buf) || { width: 0, height: 0 };
}

export async function generateViaOpenRouter(
  apiKey: string,
  modelId: string,
  request: ImageRequest,
  basePath?: string,
): Promise<ImageResult> {
  const content: any[] = [];

  if (request.referenceImages?.length) {
    for (const ref of request.referenceImages) {
      const { mimeType, data } = await loadReferenceImage(ref, basePath);
      content.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } });
    }
  }

  let promptText = request.prompt;
  if (request.negativePrompt) promptText += `\n\nAvoid: ${request.negativePrompt}`;
  content.push({ type: 'text', text: promptText });

  const body: any = {
    model: modelId,
    modalities: ['image', 'text'],
    messages: [{ role: 'user', content }],
  };

  if (request.aspectRatio || request.imageSize) {
    body.image_config = {};
    if (request.aspectRatio) body.image_config.aspect_ratio = request.aspectRatio;
    if (request.imageSize) body.image_config.image_size = request.imageSize;
  }

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/paperfoot/nanaban-cli',
        'X-Title': 'nanaban',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new NB2Error('NETWORK_ERROR', `OpenRouter request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = JSON.parse(text)?.error?.message || text;
    } catch { /* not json */ }
    if (res.status === 401) throw new NB2Error('AUTH_INVALID', `OpenRouter rejected key: ${detail}`);
    if (res.status === 429) throw new NB2Error('RATE_LIMITED', `OpenRouter rate limit: ${detail}`);
    throw new NB2Error('GENERATION_FAILED', `OpenRouter ${res.status}: ${detail}`);
  }

  const json: any = await res.json();
  const msg = json?.choices?.[0]?.message;
  const url: string | undefined = msg?.images?.[0]?.image_url?.url;
  if (!url || !url.startsWith('data:image')) {
    throw new NB2Error('GENERATION_FAILED', 'OpenRouter returned no image data');
  }

  const commaIdx = url.indexOf(',');
  const meta = url.slice(0, commaIdx);
  const b64 = url.slice(commaIdx + 1);
  const mime = meta.match(/data:(image\/[^;]+)/)?.[1] || 'image/png';
  const buffer = Buffer.from(b64, 'base64');
  const dims = parseDimensions(buffer, mime);

  return {
    buffer,
    mimeType: mime,
    width: dims.width,
    height: dims.height,
    modelId: json.model || modelId,
    transport: 'openrouter',
    durationMs: Date.now() - start,
    costUsd: typeof json?.usage?.cost === 'number' ? json.usage.cost : undefined,
  };
}
