import { NB2Error } from '../lib/errors.js';
import type { AspectRatio, ImageSize, Quality } from './types.js';
import type { RouteCaps } from './models.js';

export const ASPECT_ALIASES: Record<string, AspectRatio> = {
  square: '1:1',
  wide: '16:9',
  tall: '9:16',
  ultrawide: '21:9',
  portrait: '2:3',
  landscape: '3:2',
  story: '9:16',
};

const VALID_RATIOS = new Set<string>([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
]);

const VALID_SIZES = new Set<string>(['0.5K', '1K', '2K', '4K']);
const VALID_QUALITY = new Set<string>(['low', 'medium', 'high']);

export function parseAspectRatio(input: string): AspectRatio {
  const resolved = ASPECT_ALIASES[input.toLowerCase()] || input;
  if (!VALID_RATIOS.has(resolved)) {
    throw new NB2Error(
      'BAD_ARGUMENT',
      `Invalid aspect ratio "${input}". Use one of: ${[...VALID_RATIOS].join(', ')} (or aliases: ${Object.keys(ASPECT_ALIASES).join(', ')})`,
    );
  }
  return resolved as AspectRatio;
}

export function parseImageSize(input: string): ImageSize {
  const upper = input.toUpperCase();
  if (!VALID_SIZES.has(upper)) {
    throw new NB2Error('BAD_ARGUMENT', `Invalid size "${input}". Use one of: 0.5k, 1k, 2k, 4k`);
  }
  return upper as ImageSize;
}

export function parseQuality(input: string): Quality {
  const lower = input.toLowerCase();
  if (!VALID_QUALITY.has(lower)) {
    throw new NB2Error('BAD_ARGUMENT', `Invalid quality "${input}". Use one of: low, medium, high`);
  }
  return lower as Quality;
}

export interface RouteRequirement {
  aspect: AspectRatio;
  size: ImageSize;
  /** Undefined when the caller did not pin a size — fixed-budget routes still qualify. */
  sizeIsExplicit: boolean;
  quality?: Quality;
  mode: 'generate' | 'edit';
  referenceCount: number;
}

/**
 * Why a route cannot serve a request, or null if it can. Returning the reason
 * (rather than throwing) lets the planner rank alternatives and explain, in one
 * error, every route it rejected and what would unlock each one.
 */
export function routeRejection(caps: RouteCaps, req: RouteRequirement): string | null {
  if (req.mode === 'edit' && !caps.edit) return 'does not support editing';

  if (!caps.aspectRatios.includes(req.aspect)) {
    return `does not support aspect ratio ${req.aspect} (supports ${caps.aspectRatios.join(', ')})`;
  }

  // A fixed-budget route can never honour an explicit high-resolution request,
  // whatever its nominal `sizes` list says.
  if (req.sizeIsExplicit && caps.fixedPixelBudget && req.size !== '1K') {
    return `is fixed at ~${(caps.fixedPixelBudget / 1e6).toFixed(2)} megapixels and cannot produce ${req.size}`;
  }
  if (req.sizeIsExplicit && !caps.sizes.includes(req.size)) {
    return `does not support size ${req.size} (supports ${caps.sizes.join(', ')})`;
  }

  if (req.quality) {
    if (caps.forcedQuality && caps.forcedQuality !== req.quality) {
      return `forces quality=${caps.forcedQuality} and cannot honour quality=${req.quality}`;
    }
    if (caps.quality && !caps.quality.includes(req.quality)) {
      return `does not expose quality=${req.quality} (supports ${caps.quality.join(', ')})`;
    }
  }

  if (req.referenceCount > caps.maxRefImages) {
    return `accepts at most ${caps.maxRefImages} reference image(s), got ${req.referenceCount}`;
  }

  return null;
}

/**
 * Rank candidate routes. Every route here already satisfies the hard
 * constraints, so this only decides which satisfying route is *preferable*:
 *
 *  1. Don't spend money to deliver something a free route delivers just as well.
 *  2. But a prompt-steered frame is genuinely approximate, so when the caller
 *     asked for a specific non-square aspect, an exact route outranks a free
 *     approximate one. (Free still wins if nothing exact is reachable.)
 *  3. Cheaper breaks remaining ties.
 */
export function routeScore(caps: RouteCaps, aspectMatters: boolean): number {
  let score = 0;
  if (caps.billing === 'subscription_quota') score += 2000;
  if (aspectMatters && !caps.aspectExact) score -= 3000;
  if (!caps.fixedPixelBudget) score += 500;
  score -= Math.min(caps.costPerImageUsd * 100, 99);
  return score;
}
