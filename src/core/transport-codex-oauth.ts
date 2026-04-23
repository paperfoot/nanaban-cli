import { randomUUID } from 'node:crypto';
import { loadReferenceImage } from './reference.js';
import { NB2Error } from '../lib/errors.js';
import type { ErrorCode } from '../lib/errors.js';
import type { ImageRequest, ImageResult, AspectRatio } from './types.js';

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

// The Codex bridge rejects `gpt-image-2` as a top-level `model` — it must carry a
// Codex "coding" model that invokes the `image_generation` tool, which internally
// runs the current GPT Image model. `gpt-5.4` is the safe everyday default today;
// override via NANABAN_CODEX_CARRIER if OpenAI rotates the list.
const CARRIER_MODEL = process.env.NANABAN_CODEX_CARRIER ?? 'gpt-5.4';

// Cap on the in-flight SSE buffer so a chattery/hostile stream can't grow memory
// without bound. 32 MiB is ~ an order of magnitude above a maximal 1536x1024 PNG
// base64-encoded, which is the largest payload we ever expect in a single event.
const MAX_SSE_BUFFER = 32 * 1024 * 1024;

// gpt-image-2 via the Codex bridge accepts these three discrete output sizes.
// Any aspect ratio outside this set is rejected up front by aspect.ts
// (see GPT_IMAGE_2_RATIOS in models.ts), so this map only needs to cover them.
const SIZE_FOR_RATIO: Partial<Record<AspectRatio, string>> = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
};

function resolveSize(ratio: AspectRatio): string {
  const size = SIZE_FOR_RATIO[ratio];
  if (!size) {
    throw new NB2Error(
      'CAPABILITY_UNSUPPORTED',
      `gpt-image-2 via codex-oauth only supports aspect ratios 1:1, 2:3, 3:2 (got ${ratio})`,
    );
  }
  return size;
}

export interface CodexOAuthAuth {
  accessToken: string;
  accountId: string;
}

// Streamed `response.failed` / `error` events carry their own status / message.
// Classify them the same way as non-OK HTTP responses so the dispatch fallback
// chain treats them as transient (retryable on another transport) when warranted.
function classifyStreamFailure(parsed: any): NB2Error {
  const msg: string =
    parsed.response?.error?.message
    ?? parsed.error?.message
    ?? `Codex bridge reported ${parsed.type}`;
  const status: number | undefined =
    parsed.response?.status
    ?? parsed.response?.error?.status
    ?? parsed.error?.status
    ?? parsed.status;
  const code: string | undefined =
    parsed.response?.error?.code
    ?? parsed.error?.code;

  const authHint = / — run \`codex login\`/.test(msg) ? '' : ' — run `codex login`';

  if (status === 401 || code === 'unauthorized' || code === 'invalid_token') {
    return new NB2Error('AUTH_INVALID', `Codex OAuth token rejected${authHint}. ${msg}`);
  }
  if (status === 403 || code === 'forbidden') {
    return new NB2Error('AUTH_INVALID', `Codex bridge forbade this account: ${msg}`);
  }
  if (status === 429 || code === 'rate_limit_exceeded' || /rate.?limit|quota|exceeded/i.test(msg)) {
    return new NB2Error('RATE_LIMITED', `Codex bridge rate-limited: ${msg}`);
  }
  if (typeof status === 'number' && status >= 500) {
    return new NB2Error('NETWORK_ERROR', `Codex backend ${status}: ${msg}`);
  }
  return new NB2Error('GENERATION_FAILED', msg);
}

// Parse one SSE event (lines already split, \n-separated) and return the
// decoded JSON payload from its `data:` lines, or null if the event carries none.
function dataFromEvent(rawEvent: string): string | null {
  let data = '';
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  if (!data || data === '[DONE]') return null;
  return data;
}

type EventResult =
  | { kind: 'image'; base64: string }
  | { kind: 'failure'; err: NB2Error }
  | { kind: 'ignore' };

function classifyEvent(parsed: any): EventResult {
  if (parsed.type === 'response.output_item.done'
      && parsed.item?.type === 'image_generation_call'
      && typeof parsed.item?.result === 'string') {
    return { kind: 'image', base64: parsed.item.result };
  }
  if (parsed.type === 'response.failed' || parsed.type === 'error') {
    return { kind: 'failure', err: classifyStreamFailure(parsed) };
  }
  return { kind: 'ignore' };
}

/**
 * Call the Codex responses backend with the user's ChatGPT Plus/Pro access token.
 *
 * Protocol reference: remorses/egaki/docs/chatgpt-codex-image-backend.md
 * - Uses Responses-API shape (`input`/`input_text`/`input_image`), NOT Chat Completions.
 * - SSE events separated by `\n\n`; final image arrives in an event whose top-level
 *   `type` is `response.output_item.done` and whose `item.type` is `image_generation_call`.
 * - Billing: counts against the ChatGPT subscription — no metered cost.
 */
export async function generateViaCodexOAuth(
  auth: CodexOAuthAuth,
  modelId: string,
  request: ImageRequest,
  basePath?: string,
): Promise<ImageResult> {
  const ratio = request.aspectRatio ?? '1:1';
  const size = resolveSize(ratio);
  const [width, height] = size.split('x').map(Number);

  const content: any[] = [];
  if (request.referenceImages?.length) {
    for (const ref of request.referenceImages) {
      const { mimeType, data } = await loadReferenceImage(ref, basePath);
      // egaki verified shape: input_image carries a string image_url (data URL or https URL).
      content.push({ type: 'input_image', image_url: `data:${mimeType};base64,${data}` });
    }
  }

  let promptText = request.prompt;
  if (request.negativePrompt) promptText += `\n\nAvoid: ${request.negativePrompt}`;
  content.push({ type: 'input_text', text: promptText });

  const body = {
    model: CARRIER_MODEL,
    instructions:
      'You generate or edit images using the image_generation tool. ' +
      'Always call the tool exactly once and return the result. Do not describe the image in text.',
    input: [{ type: 'message', role: 'user', content }],
    tools: [{ type: 'image_generation', output_format: 'png', size }],
    tool_choice: { type: 'image_generation' },
    stream: true,
    store: false,
    prompt_cache_key: randomUUID(),
  };

  const start = Date.now();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth.accessToken}`,
        'ChatGPT-Account-ID': auth.accountId,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'OpenAI-Beta': 'responses=experimental',
        'Originator': 'nanaban-cli',
        'Session-Id': randomUUID(),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new NB2Error('NETWORK_ERROR', `Codex bridge request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { detail = JSON.parse(text)?.error?.message || text; } catch { /* not json */ }
    const code: ErrorCode =
      res.status === 401 || res.status === 403 ? 'AUTH_INVALID'
      : res.status === 429 ? 'RATE_LIMITED'
      : res.status >= 500 ? 'NETWORK_ERROR'
      : 'GENERATION_FAILED';
    const prefix =
      code === 'AUTH_INVALID' ? 'Codex OAuth token rejected — run `codex login`. '
      : code === 'RATE_LIMITED' ? 'Codex bridge rate-limited (ChatGPT sub quota): '
      : code === 'NETWORK_ERROR' ? `Codex backend ${res.status}: `
      : `Codex backend ${res.status}: `;
    throw new NB2Error(code, `${prefix}${detail}`);
  }

  if (!res.body) throw new NB2Error('GENERATION_FAILED', 'Codex bridge returned empty body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let base64: string | null = null;
  let failure: NB2Error | null = null;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.length > MAX_SSE_BUFFER) {
        throw new NB2Error(
          'GENERATION_FAILED',
          `Codex bridge sent >${MAX_SSE_BUFFER >> 20}MB without delivering an image — aborting.`,
        );
      }

      // SSE events are separated by a blank line (\n\n). Handle CRLF too.
      buf = buf.replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const rawEvent = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataStr = dataFromEvent(rawEvent);
        if (!dataStr) continue;
        let parsed: any;
        try { parsed = JSON.parse(dataStr); } catch { continue; }

        const ev = classifyEvent(parsed);
        if (ev.kind === 'image') { base64 = ev.base64; break outer; }
        if (ev.kind === 'failure') { failure = ev.err; break outer; }
      }
    }

    // Flush the decoder and any trailing event not terminated by \n\n. The Codex
    // bridge has been observed to close the stream without the trailing blank
    // line, which would otherwise strand the final image in buf.
    if (!base64 && !failure) {
      buf += decoder.decode();
      buf = buf.replace(/\r\n/g, '\n');
      const tail = buf.trim();
      if (tail.length > 0) {
        const dataStr = dataFromEvent(tail);
        if (dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            const ev = classifyEvent(parsed);
            if (ev.kind === 'image') base64 = ev.base64;
            else if (ev.kind === 'failure') failure = ev.err;
          } catch { /* unparseable trailer — fall through */ }
        }
      }
    }
  } finally {
    // Release the connection promptly whether we exited with an image, a failure,
    // or an exception. Swallow any cancel error — we've already got what we need.
    await reader.cancel().catch(() => {});
  }

  if (failure) throw failure;
  if (!base64) {
    throw new NB2Error(
      'GENERATION_FAILED',
      'Codex bridge stream finished without an image — ChatGPT subscription may have hit its image quota.',
    );
  }

  const buffer = Buffer.from(base64, 'base64');
  return {
    buffer,
    mimeType: 'image/png',
    width,
    height,
    modelId,
    transport: 'codex-oauth',
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}
