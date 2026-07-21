import { loadReferenceImage } from './reference.js';
import { NB2Error, requestTimeoutMs } from '../lib/errors.js';
import { inspectImage } from '../lib/image-meta.js';
import type { ImageRequest, ImageResult } from './types.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

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
        'HTTP-Referer': 'https://github.com/paperfoot/nanaban',
        'X-Title': 'nanaban',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new NB2Error('TIMEOUT', `OpenRouter request timed out after ${requestTimeoutMs()}ms`);
    }
    throw new NB2Error('NETWORK_ERROR', `OpenRouter request failed: ${e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = JSON.parse(text)?.error?.message || text;
    } catch { /* not json */ }
    if (res.status === 401 || res.status === 403) throw new NB2Error('AUTH_INVALID', `OpenRouter rejected key: ${detail}`);
    if (res.status === 402) throw new NB2Error('AUTH_INVALID', `OpenRouter: insufficient credits: ${detail}`);
    if (res.status === 429) throw new NB2Error('RATE_LIMITED', `OpenRouter rate limit: ${detail}`);
    // 5xx / 408 / 425 are transient upstream failures — NETWORK_ERROR so the
    // dispatch fallback chain can retry on another transport (the manifest's
    // documented behavior; GENERATION_FAILED here used to defeat it).
    if (res.status >= 500 || res.status === 408 || res.status === 425) {
      throw new NB2Error('NETWORK_ERROR', `OpenRouter ${res.status}: ${detail}`);
    }
    throw new NB2Error('GENERATION_FAILED', `OpenRouter ${res.status}: ${detail}`);
  }

  let json: any;
  try {
    json = await res.json();
  } catch (err) {
    throw new NB2Error('NETWORK_ERROR', `OpenRouter response body unreadable: ${(err as Error).message}`);
  }
  const msg = json?.choices?.[0]?.message;
  const url: string | undefined = msg?.images?.[0]?.image_url?.url;
  if (!url || !url.startsWith('data:image')) {
    throw new NB2Error('GENERATION_FAILED', 'OpenRouter returned no image data');
  }

  const commaIdx = url.indexOf(',');
  const declaredMime = url.slice(0, commaIdx).match(/data:(image\/[^;]+)/)?.[1] || 'image/png';
  const buffer = Buffer.from(url.slice(commaIdx + 1), 'base64');
  if (buffer.length === 0) {
    throw new NB2Error('GENERATION_FAILED', 'OpenRouter returned an empty image payload');
  }
  const meta = inspectImage(buffer);

  return {
    buffer,
    mimeType: meta.mimeType || declaredMime,
    width: meta.width,
    height: meta.height,
    modelId: json.model || modelId,
    transport: 'openrouter',
    durationMs: Date.now() - start,
    costUsd: typeof json?.usage?.cost === 'number' ? json.usage.cost : undefined,
  };
}
