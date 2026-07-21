import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can',
  'that', 'this', 'these', 'those', 'it', 'its', 'my', 'your',
  'very', 'really', 'just', 'also', 'so', 'than', 'then',
  'some', 'any', 'each', 'every', 'all', 'both', 'few', 'more',
]);

const MAX_WORDS = 6;

export function slugFromPrompt(prompt: string): string {
  // Unicode-aware: fold diacritics to ASCII where NFKD allows (café → cafe),
  // keep letters/digits in any script — CJK/Cyrillic/Arabic prompts used to
  // all collapse to the constant "image", maximizing collision races.
  const words = prompt
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOP_WORDS.has(w));

  const slug = words.slice(0, MAX_WORDS).join('_');
  if (slug) return slug;
  // Distinct prompts must never share a base name.
  return 'image_' + createHash('sha256').update(prompt).digest('hex').slice(0, 8);
}

export async function autoName(prompt: string, dir: string, ext = '.png'): Promise<string> {
  const base = slugFromPrompt(prompt);
  let candidate = base + ext;
  let i = 2;

  while (true) {
    try {
      await fs.access(path.join(dir, candidate));
      candidate = `${base}_${i}${ext}`;
      i++;
    } catch {
      return candidate;
    }
  }
}
