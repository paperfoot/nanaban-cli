import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateViaCodexOAuth } from '../src/core/transport-codex-oauth.js';
import type { ImageRequest } from '../src/core/types.js';

// 1x1 transparent PNG, base64-encoded.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;

beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

function sseStream(events: string[], opts: { dropTrailingTerminator?: boolean } = {}): ReadableStream<Uint8Array> {
  // SSE events end with `\n\n` and `data:` lines carry the JSON payload.
  const encoder = new TextEncoder();
  let body = events.map(e => `data: ${e}\n\n`).join('');
  // Codex has been observed closing the stream without the trailing blank line —
  // exercise that path so the parser's EOF flush has coverage.
  if (opts.dropTrailingTerminator && body.endsWith('\n\n')) {
    body = body.slice(0, -2);
  }
  return new ReadableStream({
    start(controller) {
      // Split into two chunks to exercise buffering across reads.
      const mid = Math.floor(body.length / 2);
      controller.enqueue(encoder.encode(body.slice(0, mid)));
      controller.enqueue(encoder.encode(body.slice(mid)));
      controller.close();
    },
  });
}

describe('transport-codex-oauth', () => {
  it('parses response.output_item.done and returns the image', async () => {
    const events = [
      JSON.stringify({ type: 'response.created' }),
      JSON.stringify({
        type: 'response.output_item.done',
        item: { type: 'image_generation_call', result: TINY_PNG_B64 },
      }),
      JSON.stringify({ type: 'response.completed' }),
    ];
    globalThis.fetch = (async () => new Response(sseStream(events), { status: 200 })) as FetchFn;

    const req: ImageRequest = { mode: 'generate', prompt: 'a red apple', aspectRatio: '1:1' };
    const res = await generateViaCodexOAuth(
      { accessToken: 'tok', accountId: 'acct' },
      'gpt-image-2',
      req,
    );

    assert.equal(res.transport, 'codex-oauth');
    assert.equal(res.modelId, 'gpt-image-2');
    assert.equal(res.mimeType, 'image/png');
    // Dimensions are MEASURED from the returned bytes (the bridge ignores the
    // requested size), so a 1x1 fixture must report 1x1 — never the request.
    assert.equal(res.width, 1);
    assert.equal(res.height, 1);
    assert.equal(res.costUsd, 0);
    assert.equal(res.buffer.toString('base64'), TINY_PNG_B64);
  });

  it('requests 1024x1536 for 2:3 / 1536x1024 for 3:2 and injects a prompt aspect hint', async () => {
    const events = [JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: TINY_PNG_B64 },
    })];
    let capturedBody: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(sseStream(events), { status: 200 });
    }) as FetchFn;

    await generateViaCodexOAuth(
      { accessToken: 't', accountId: 'a' },
      'gpt-image-2',
      { mode: 'generate', prompt: 'x', aspectRatio: '2:3' },
    );
    assert.equal(capturedBody.tools[0].size, '1024x1536');
    // The bridge ignores tools[].size, so the aspect must also be steered
    // through the prompt (live-verified to work).
    assert.match(capturedBody.input[0].content.at(-1).text, /2:3 aspect ratio.*portrait/);

    await generateViaCodexOAuth(
      { accessToken: 't', accountId: 'a' },
      'gpt-image-2',
      { mode: 'generate', prompt: 'x', aspectRatio: '3:2' },
    );
    assert.equal(capturedBody.tools[0].size, '1536x1024');
    assert.match(capturedBody.input[0].content.at(-1).text, /3:2 aspect ratio.*landscape/);
  });

  it('sends Responses-API shape (input + input_text), not Chat Completions', async () => {
    const events = [JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: TINY_PNG_B64 },
    })];
    let captured: any = null;
    globalThis.fetch = (async (_u: any, init: any) => {
      captured = { body: JSON.parse(init.body), headers: init.headers };
      return new Response(sseStream(events), { status: 200 });
    }) as FetchFn;

    await generateViaCodexOAuth(
      { accessToken: 'tok', accountId: 'acct' },
      'gpt-image-2',
      { mode: 'generate', prompt: 'hello' },
    );

    assert.ok(Array.isArray(captured.body.input), 'uses `input` (Responses API), not `messages`');
    assert.equal(captured.body.input[0].type, 'message');
    assert.equal(captured.body.input[0].content[0].type, 'input_text');
    assert.equal(captured.body.tools[0].type, 'image_generation');
    assert.equal(captured.body.tool_choice.type, 'image_generation');
    assert.equal(captured.body.stream, true);
    assert.equal(captured.body.store, false);
    assert.ok(typeof captured.body.prompt_cache_key === 'string');
    assert.equal(captured.headers['Authorization'], 'Bearer tok');
    assert.equal(captured.headers['ChatGPT-Account-ID'], 'acct');
  });

  it('encodes reference images as input_image with data URL', async () => {
    const events = [JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: TINY_PNG_B64 },
    })];
    let capturedBody: any = null;
    globalThis.fetch = (async (_u: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(sseStream(events), { status: 200 });
    }) as FetchFn;

    await generateViaCodexOAuth(
      { accessToken: 't', accountId: 'a' },
      'gpt-image-2',
      {
        mode: 'edit',
        prompt: 'make it blue',
        referenceImages: [{ source: 'base64', data: TINY_PNG_B64, mimeType: 'image/png' }],
      },
    );

    const content = capturedBody.input[0].content;
    assert.equal(content[0].type, 'input_image');
    assert.ok(typeof content[0].image_url === 'string', 'image_url must be a string, not an object');
    assert.ok(content[0].image_url.startsWith('data:image/png;base64,'));
    assert.equal(content[1].type, 'input_text');
  });

  it('throws CAPABILITY_UNSUPPORTED for aspect ratios outside {1:1, 2:3, 3:2}', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response(''); }) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x', aspectRatio: '16:9' },
      ),
      (err: any) => err.code === 'CAPABILITY_UNSUPPORTED',
    );
    assert.equal(called, false, 'must reject before hitting the network');
  });

  it('maps 401 → AUTH_INVALID with `codex login` hint', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 401 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 'bad', accountId: 'bad' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'AUTH_INVALID' && /codex login/.test(err.message),
    );
  });

  it('maps 429 → RATE_LIMITED', async () => {
    globalThis.fetch = (async () => new Response('slow down', { status: 429 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'RATE_LIMITED',
    );
  });

  it('maps 500 → NETWORK_ERROR (retriable on another transport)', async () => {
    globalThis.fetch = (async () => new Response('oops', { status: 500 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'NETWORK_ERROR',
    );
  });

  it('fails cleanly when the stream ends without an image', async () => {
    const events = [
      JSON.stringify({ type: 'response.created' }),
      JSON.stringify({ type: 'response.completed' }),
    ];
    globalThis.fetch = (async () => new Response(sseStream(events), { status: 200 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'GENERATION_FAILED',
    );
  });

  it('surfaces response.failed (content policy) as GENERATION_FAILED', async () => {
    const events = [JSON.stringify({
      type: 'response.failed',
      response: { error: { message: 'content policy block' } },
    })];
    globalThis.fetch = (async () => new Response(sseStream(events), { status: 200 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'GENERATION_FAILED' && /content policy/.test(err.message),
    );
  });

  it('classifies streamed response.failed with status:429 as RATE_LIMITED', async () => {
    const events = [JSON.stringify({
      type: 'response.failed',
      response: { status: 429, error: { message: 'ChatGPT image quota exceeded' } },
    })];
    globalThis.fetch = (async () => new Response(sseStream(events), { status: 200 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'RATE_LIMITED' && /quota/.test(err.message),
    );
  });

  it('classifies streamed response.failed with status:401 as AUTH_INVALID', async () => {
    const events = [JSON.stringify({
      type: 'response.failed',
      response: { status: 401, error: { message: 'token expired' } },
    })];
    globalThis.fetch = (async () => new Response(sseStream(events), { status: 200 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'AUTH_INVALID' && /codex login/.test(err.message),
    );
  });

  it('classifies streamed response.failed with status:500 as NETWORK_ERROR (retryable)', async () => {
    const events = [JSON.stringify({
      type: 'response.failed',
      response: { status: 503, error: { message: 'backend unavailable' } },
    })];
    globalThis.fetch = (async () => new Response(sseStream(events), { status: 200 })) as FetchFn;

    await assert.rejects(
      () => generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      ),
      (err: any) => err.code === 'NETWORK_ERROR',
    );
  });

  it('retries on transient "stream disconnected" upstream failures and succeeds on second attempt', async () => {
    process.env.NANABAN_CODEX_RETRY_MS = '0';
    const transientEvent = JSON.stringify({
      type: 'response.failed',
      response: { error: { message: 'stream disconnected before completion: An error occurred while processing your request. Request ID xyz' } },
    });
    const okEvents = [JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: TINY_PNG_B64 },
    })];
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response(sseStream([transientEvent]), { status: 200 });
      return new Response(sseStream(okEvents), { status: 200 });
    }) as FetchFn;

    try {
      const res = await generateViaCodexOAuth(
        { accessToken: 't', accountId: 'a' },
        'gpt-image-2',
        { mode: 'generate', prompt: 'x' },
      );
      assert.equal(calls, 2, 'must retry exactly once on stream-disconnect');
      assert.equal(res.buffer.toString('base64'), TINY_PNG_B64);
    } finally {
      delete process.env.NANABAN_CODEX_RETRY_MS;
    }
  });

  it('surfaces an agent-friendly GENERATION_FAILED after retries are exhausted — no silent fallback', async () => {
    process.env.NANABAN_CODEX_RETRY_MS = '0';
    const transientEvent = JSON.stringify({
      type: 'response.failed',
      response: { error: { message: 'stream disconnected before completion: An error occurred while processing your request. Request ID xyz' } },
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(sseStream([transientEvent]), { status: 200 });
    }) as FetchFn;

    try {
      await assert.rejects(
        () => generateViaCodexOAuth(
          { accessToken: 't', accountId: 'a' },
          'gpt-image-2',
          { mode: 'generate', prompt: 'x' },
        ),
        (err: any) =>
          err.code === 'GENERATION_FAILED'
          && /disconnected/i.test(err.message)
          && /help\.openai\.com/.test(err.message)
          && /--via openrouter/.test(err.message)
          && /--via gemini/.test(err.message),
      );
      // 1 initial + 2 retries = 3 attempts by default (MAX_RETRIES=2).
      assert.equal(calls, 3, 'must attempt MAX_RETRIES+1 times');
    } finally {
      delete process.env.NANABAN_CODEX_RETRY_MS;
    }
  });

  it('does NOT retry on content-policy failures (non-upstream-transient)', async () => {
    process.env.NANABAN_CODEX_RETRY_MS = '0';
    const events = [JSON.stringify({
      type: 'response.failed',
      response: { error: { message: 'content policy block: disallowed content' } },
    })];
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(sseStream(events), { status: 200 });
    }) as FetchFn;

    try {
      await assert.rejects(
        () => generateViaCodexOAuth(
          { accessToken: 't', accountId: 'a' },
          'gpt-image-2',
          { mode: 'generate', prompt: 'x' },
        ),
        (err: any) => err.code === 'GENERATION_FAILED' && /content policy/.test(err.message),
      );
      assert.equal(calls, 1, 'content-policy blocks must NOT retry');
    } finally {
      delete process.env.NANABAN_CODEX_RETRY_MS;
    }
  });

  it('flushes the final event at EOF when the stream closes without a trailing blank line', async () => {
    const events = [JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'image_generation_call', result: TINY_PNG_B64 },
    })];
    globalThis.fetch = (async () => new Response(sseStream(events, { dropTrailingTerminator: true }), { status: 200 })) as FetchFn;

    const res = await generateViaCodexOAuth(
      { accessToken: 't', accountId: 'a' },
      'gpt-image-2',
      { mode: 'generate', prompt: 'x' },
    );
    assert.equal(res.buffer.toString('base64'), TINY_PNG_B64);
  });
});
