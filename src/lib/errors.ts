export type ErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'PROMPT_MISSING'
  | 'BAD_ARGUMENT'
  | 'IMAGE_NOT_FOUND'
  | 'INPUT_TOO_LARGE'
  | 'GENERATION_FAILED'
  | 'CONTENT_BLOCKED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'MODEL_NOT_FOUND'
  | 'TRANSPORT_UNAVAILABLE'
  | 'CAPABILITY_UNSUPPORTED'
  | 'OUTPUT_UNWRITABLE';

// Agent CLI Framework contract: 0 success · 1 transient (retry) ·
// 2 config error (fix setup, don't retry) · 3 bad input (fix args) ·
// 4 rate limited (wait, retry).
export const EXIT_CODES: Record<ErrorCode, number> = {
  AUTH_MISSING: 2,
  AUTH_INVALID: 2,
  AUTH_EXPIRED: 2,
  PROMPT_MISSING: 3,
  BAD_ARGUMENT: 3,
  IMAGE_NOT_FOUND: 3,
  INPUT_TOO_LARGE: 3,
  GENERATION_FAILED: 1,
  CONTENT_BLOCKED: 3,
  RATE_LIMITED: 4,
  NETWORK_ERROR: 1,
  TIMEOUT: 1,
  MODEL_NOT_FOUND: 3,
  TRANSPORT_UNAVAILABLE: 2,
  CAPABILITY_UNSUPPORTED: 3,
  OUTPUT_UNWRITABLE: 3,
};

export class NB2Error extends Error {
  code: ErrorCode;
  exitCode: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'NB2Error';
    this.code = code;
    this.exitCode = EXIT_CODES[code];
  }
}

// Keyword heuristics for errors that arrive as bare strings from SDKs and
// fetch. Patterns are phrase-anchored: a bare substring like "rate" used to
// classify "Failed to generate image" as RATE_LIMITED (exit 4, "wait and
// retry") — every pattern here must not fire on ordinary generation prose.
export function normalizeError(err: unknown): NB2Error {
  if (err instanceof NB2Error) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  const name = err instanceof Error ? err.name : '';

  if (name === 'AbortError' || name === 'TimeoutError' || /\btimed? ?out\b|\baborted\b/.test(lower))
    return new NB2Error('TIMEOUT', msg);
  if (/\benoent\b|no such file/.test(lower))
    return new NB2Error('IMAGE_NOT_FOUND', msg);
  if (/\b(safety|moderat\w+|content polic\w+|blocked by|prohibited content)\b/.test(lower))
    return new NB2Error('CONTENT_BLOCKED', msg);
  if (lower.includes('invalid') && (lower.includes('key') || lower.includes('auth') || lower.includes('token')))
    return new NB2Error('AUTH_INVALID', msg);
  if (lower.includes('expired') || lower.includes('refresh'))
    return new NB2Error('AUTH_EXPIRED', msg);
  if (lower.includes('api key') || lower.includes('authentication') || lower.includes('no authentication'))
    return new NB2Error('AUTH_MISSING', msg);
  if (/rate.?limit|\b429\b|\bquota\b|resource.?exhausted/.test(lower))
    return new NB2Error('RATE_LIMITED', msg);
  if (/\bnetwork\b|econnrefused|econnreset|etimedout|eai_again|fetch failed|socket/.test(lower))
    return new NB2Error('NETWORK_ERROR', msg);
  if (/\b50[0-4]\b|unavailable|overloaded|bad gateway/.test(lower))
    return new NB2Error('NETWORK_ERROR', msg);

  return new NB2Error('GENERATION_FAILED', msg);
}

// Transport-level failures worth retrying on a different transport.
// These are conditions that may succeed on the other provider:
//   - rate limits / quotas (different provider = different bucket)
//   - network blips / timeouts
//   - provider-side auth weirdness (bad key on one, valid on the other)
// GENERATION_FAILED and CONTENT_BLOCKED are NOT transient — typically a
// content-policy block or malformed request, and the other provider will
// reject it the same way.
export function isTransient(err: NB2Error): boolean {
  switch (err.code) {
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'AUTH_INVALID':
    case 'AUTH_EXPIRED':
      return true;
    default:
      return false;
  }
}

// Codes worth an in-place retry / provider fallback, exported so agent-info
// can publish the exact list the dispatcher actually uses (no hand-copied
// duplicates that drift).
export function transientCodes(): ErrorCode[] {
  return (Object.keys(EXIT_CODES) as ErrorCode[]).filter(c => isTransient(new NB2Error(c, '')));
}

/** Overall per-request deadline for provider calls, in milliseconds. */
export function requestTimeoutMs(): number {
  const raw = Number(process.env.NANABAN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 240_000;
}
