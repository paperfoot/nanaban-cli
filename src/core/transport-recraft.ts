import { NB2Error, requestTimeoutMs } from '../lib/errors.js';

// Recraft Crisp Upscale: sync multipart POST, inline base64 response, flat
// $0.004/image (2026-07 pricing). No prompt, no scale parameter — the service
// picks the enlargement (up to ~4096px edge).
const ENDPOINT = 'https://external.api.recraft.ai/v1/images/crispUpscale';

export const RECRAFT_MODEL = 'recraft/crisp-upscale';
export const RECRAFT_EST_COST_USD = 0.004;

export async function upscaleViaRecraft(
  token: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<{ buffer: Buffer; durationMs: number }> {
  const start = Date.now();

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(imageBuffer)], { type: mimeType }), 'input.png');
  form.append('response_format', 'b64_json');

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new NB2Error('TIMEOUT', `Recraft request timed out after ${requestTimeoutMs()}ms`);
    }
    throw new NB2Error('NETWORK_ERROR', `Recraft request failed: ${e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { detail = JSON.parse(text)?.message || JSON.parse(text)?.error || text; } catch { /* not json */ }
    if (res.status === 401 || res.status === 403) throw new NB2Error('AUTH_INVALID', `Recraft rejected the API token: ${detail}`);
    if (res.status === 402) throw new NB2Error('AUTH_INVALID', `Recraft: insufficient credits: ${detail}`);
    if (res.status === 429) throw new NB2Error('RATE_LIMITED', `Recraft rate limit: ${detail}`);
    if (res.status >= 500) throw new NB2Error('NETWORK_ERROR', `Recraft ${res.status}: ${detail}`);
    throw new NB2Error('GENERATION_FAILED', `Recraft ${res.status}: ${detail}`);
  }

  const json: any = await res.json().catch(() => null);
  const b64: string | undefined = json?.image?.b64_json ?? json?.data?.[0]?.b64_json;
  if (!b64) throw new NB2Error('GENERATION_FAILED', 'Recraft returned no image payload');

  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) throw new NB2Error('GENERATION_FAILED', 'Recraft returned an empty image');
  return { buffer, durationMs: Date.now() - start };
}
