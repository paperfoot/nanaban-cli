// Byte-level image inspection shared by every transport: sniff the real MIME
// type and measure real dimensions from the returned buffer instead of trusting
// what was requested. Providers routinely ignore size parameters (the Codex
// bridge returns ~1254px squares no matter what size is asked for), so the
// envelope must report what actually came back.

export interface ImageMeta {
  mimeType: string | null;
  width: number;
  height: number;
}

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export function extensionForMime(mime: string | null | undefined): string {
  return (mime && EXT_FOR_MIME[mime]) || '.png';
}

export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// JPEG scan hardened against real-world files: skips 0xFF fill bytes, passes
// over segment-less markers (TEM, RSTn, SOI/EOI), and stops at SOS — entropy-
// coded data after SOS is not marker-aligned, so scanning past it reads garbage.
function jpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return null;
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++; // fill bytes
    const marker = buf[i + 1];
    i += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no segment
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS: no SOF seen
    if (i + 1 >= buf.length) return null;
    const segLen = buf.readUInt16BE(i);
    if (segLen < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 6 >= buf.length) return null;
      return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) };
    }
    i += segLen;
  }
  return null;
}

function webpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    // Extended: 24-bit little-endian canvas width-1 / height-1 at offsets 24 / 27.
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width: w, height: h };
  }
  if (chunk === 'VP8 ') {
    // Lossy: frame tag starts at 20; dims are 14-bit LE at 26 / 28.
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function gifDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/**
 * Inspect an image buffer: sniffed MIME plus measured dimensions.
 * Dimensions are 0x0 only when the format is unrecognized or the header is
 * malformed — callers should treat 0x0 as "unknown", never as a real size.
 */
export function inspectImage(buf: Buffer): ImageMeta {
  const mime = sniffMime(buf);
  let dims: { width: number; height: number } | null = null;
  if (mime === 'image/png') dims = pngDimensions(buf);
  else if (mime === 'image/jpeg') dims = jpegDimensions(buf);
  else if (mime === 'image/webp') dims = webpDimensions(buf);
  else if (mime === 'image/gif') dims = gifDimensions(buf);
  return { mimeType: mime, width: dims?.width ?? 0, height: dims?.height ?? 0 };
}
