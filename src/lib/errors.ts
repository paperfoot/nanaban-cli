export type ErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'PROMPT_MISSING'
  | 'IMAGE_NOT_FOUND'
  | 'GENERATION_FAILED'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'MODEL_NOT_FOUND'
  | 'TRANSPORT_UNAVAILABLE'
  | 'CAPABILITY_UNSUPPORTED';

const EXIT_CODES: Record<ErrorCode, number> = {
  AUTH_MISSING: 1,
  AUTH_INVALID: 1,
  AUTH_EXPIRED: 1,
  PROMPT_MISSING: 2,
  IMAGE_NOT_FOUND: 2,
  GENERATION_FAILED: 1,
  RATE_LIMITED: 1,
  NETWORK_ERROR: 1,
  MODEL_NOT_FOUND: 2,
  TRANSPORT_UNAVAILABLE: 1,
  CAPABILITY_UNSUPPORTED: 2,
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

export function normalizeError(err: unknown): NB2Error {
  if (err instanceof NB2Error) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('invalid') && (lower.includes('key') || lower.includes('auth')))
    return new NB2Error('AUTH_INVALID', msg);
  if (lower.includes('expired') || lower.includes('refresh'))
    return new NB2Error('AUTH_EXPIRED', msg);
  if (lower.includes('api key') || lower.includes('authentication') || lower.includes('no authentication'))
    return new NB2Error('AUTH_MISSING', msg);
  if (lower.includes('rate') || lower.includes('quota') || lower.includes('429'))
    return new NB2Error('RATE_LIMITED', msg);
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('fetch'))
    return new NB2Error('NETWORK_ERROR', msg);
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('504') || lower.includes('unavailable') || lower.includes('overloaded'))
    return new NB2Error('NETWORK_ERROR', msg);

  return new NB2Error('GENERATION_FAILED', msg);
}

// Transport-level failures worth retrying on a different transport.
// These are conditions that may succeed on the other provider:
//   - rate limits / quotas (different provider = different bucket)
//   - network blips
//   - provider-side auth weirdness (bad key on one, valid on the other)
// GENERATION_FAILED is NOT transient — typically a content-policy block or
// malformed request, and the other provider will reject it the same way.
export function isTransient(err: NB2Error): boolean {
  switch (err.code) {
    case 'RATE_LIMITED':
    case 'NETWORK_ERROR':
    case 'AUTH_INVALID':
    case 'AUTH_EXPIRED':
      return true;
    default:
      return false;
  }
}
