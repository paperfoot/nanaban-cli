import { NB2Error, requestTimeoutMs } from '../lib/errors.js';

// Real-ESRGAN on Replicate: true learned super-resolution (content-preserving
// best-effort, unlike generative re-rendering). Single POST with Prefer: wait
// holds the connection for a sync result; falls back to bounded polling.
// Pricing (2026-07): ~$0.002 per output image.
const MODEL_ENDPOINT = 'https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions';

export const REPLICATE_MODEL = 'nightmareai/real-esrgan';
export const REPLICATE_EST_COST_USD = 0.002;

interface Prediction {
  id?: string;
  status?: string;
  output?: string | string[];
  error?: string | null;
  urls?: { get?: string };
}

function classify(status: number, detail: string): NB2Error {
  if (status === 401 || status === 403) return new NB2Error('AUTH_INVALID', `Replicate rejected the API token: ${detail}`);
  if (status === 402) return new NB2Error('AUTH_INVALID', `Replicate: insufficient credit: ${detail}`);
  if (status === 429) return new NB2Error('RATE_LIMITED', `Replicate rate limit: ${detail}`);
  if (status >= 500) return new NB2Error('NETWORK_ERROR', `Replicate ${status}: ${detail}`);
  return new NB2Error('GENERATION_FAILED', `Replicate ${status}: ${detail}`);
}

async function replicateFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=60',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new NB2Error('TIMEOUT', `Replicate request timed out after ${requestTimeoutMs()}ms`);
    }
    throw new NB2Error('NETWORK_ERROR', `Replicate request failed: ${e.message}`);
  }
}

export async function upscaleViaReplicate(
  token: string,
  imageBuffer: Buffer,
  mimeType: string,
  scale: number,
  faceEnhance: boolean,
): Promise<{ buffer: Buffer; durationMs: number }> {
  const start = Date.now();
  const deadlineAt = start + requestTimeoutMs();

  const res = await replicateFetch(MODEL_ENDPOINT, token, {
    method: 'POST',
    body: JSON.stringify({
      input: {
        image: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
        scale,
        face_enhance: faceEnhance,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { detail = JSON.parse(text)?.detail || JSON.parse(text)?.title || text; } catch { /* not json */ }
    throw classify(res.status, detail);
  }

  let prediction = (await res.json()) as Prediction;

  // Prefer: wait usually returns a terminal state; poll if the queue was busy.
  while (prediction.status === 'starting' || prediction.status === 'processing' || prediction.status === 'queued') {
    if (Date.now() > deadlineAt) {
      throw new NB2Error('TIMEOUT', `Replicate prediction ${prediction.id ?? ''} still ${prediction.status} after ${requestTimeoutMs()}ms`);
    }
    if (!prediction.urls?.get) {
      throw new NB2Error('GENERATION_FAILED', 'Replicate returned a pending prediction without a polling URL');
    }
    await new Promise(r => setTimeout(r, 2000));
    const poll = await replicateFetch(prediction.urls.get, token);
    if (!poll.ok) throw classify(poll.status, await poll.text().catch(() => ''));
    prediction = (await poll.json()) as Prediction;
  }

  if (prediction.status !== 'succeeded') {
    throw new NB2Error('GENERATION_FAILED', `Replicate prediction ${prediction.status}: ${prediction.error ?? 'no error detail'}`);
  }

  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!outputUrl) throw new NB2Error('GENERATION_FAILED', 'Replicate prediction succeeded but returned no output URL');

  let download: Response;
  try {
    download = await fetch(outputUrl, { signal: AbortSignal.timeout(requestTimeoutMs()) });
  } catch (err) {
    throw new NB2Error('NETWORK_ERROR', `Failed to download upscaled image: ${(err as Error).message}`);
  }
  if (!download.ok) throw new NB2Error('NETWORK_ERROR', `Upscaled image download failed: HTTP ${download.status}`);

  const buffer = Buffer.from(await download.arrayBuffer());
  if (buffer.length === 0) throw new NB2Error('GENERATION_FAILED', 'Replicate returned an empty image');
  return { buffer, durationMs: Date.now() - start };
}
