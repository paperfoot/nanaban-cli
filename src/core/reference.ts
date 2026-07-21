import fs from 'fs/promises';
import path from 'path';
import { NB2Error, requestTimeoutMs } from '../lib/errors.js';
import { sniffMime } from '../lib/image-meta.js';

export interface ReferenceImage {
  source: 'file' | 'base64' | 'url';
  path?: string;
  data?: string;
  url?: string;
  mimeType?: string;
}

export interface LoadedImage {
  mimeType: string;
  data: string;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// Providers cap inline request payloads around 20 MB (Gemini) and the Codex
// bridge chokes on 50 MB JSON bodies. Reject oversized references up front with
// a typed non-retryable error instead of letting the upstream 4xx surface as
// GENERATION_FAILED ("transient — retry", which can never help).
const maxRefBytes = () => {
  const raw = Number(process.env.NANABAN_MAX_REF_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 20 * 1024 * 1024;
};

function checkSize(bytes: number, label: string): void {
  const cap = maxRefBytes();
  if (bytes > cap) {
    throw new NB2Error(
      'INPUT_TOO_LARGE',
      `Reference image ${label} is ${(bytes / 1024 / 1024).toFixed(1)} MB — providers reject inline images over ` +
        `${Math.round(cap / 1024 / 1024)} MB. Downscale or re-encode it first (e.g. \`sips -Z 2048 <file>\`).`,
    );
  }
}

export async function loadReferenceImage(ref: ReferenceImage, basePath?: string): Promise<LoadedImage> {
  if (ref.source === 'base64' && ref.data) {
    return { mimeType: ref.mimeType || 'image/png', data: ref.data };
  }

  if (ref.source === 'url' && ref.url) {
    let response: Response;
    try {
      response = await fetch(ref.url, { signal: AbortSignal.timeout(requestTimeoutMs()) });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        throw new NB2Error('TIMEOUT', `Timed out fetching reference image: ${ref.url}`);
      }
      throw new NB2Error('NETWORK_ERROR', `Failed to fetch reference image ${ref.url}: ${e.message}`);
    }
    if (!response.ok) {
      throw new NB2Error('IMAGE_NOT_FOUND', `Reference URL returned HTTP ${response.status}: ${ref.url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    checkSize(buffer.length, ref.url);
    const mime = sniffMime(buffer) || response.headers.get('content-type') || 'image/png';
    return { mimeType: mime, data: buffer.toString('base64') };
  }

  if (ref.source === 'file' && ref.path) {
    const filePath = basePath ? path.resolve(basePath, ref.path) : path.resolve(ref.path);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
        throw new NB2Error('IMAGE_NOT_FOUND', `Reference image not found: ${filePath}`);
      }
      if (e.code === 'EISDIR') {
        throw new NB2Error('IMAGE_NOT_FOUND', `Reference path is a directory, not an image: ${filePath}`);
      }
      throw new NB2Error('IMAGE_NOT_FOUND', `Cannot read reference image ${filePath}: ${e.message}`);
    }
    checkSize(buffer.length, filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = sniffMime(buffer) || MIME_MAP[ext] || 'image/png';
    return { mimeType: mime, data: buffer.toString('base64') };
  }

  throw new NB2Error('IMAGE_NOT_FOUND', 'Invalid reference image configuration');
}
