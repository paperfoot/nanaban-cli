import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel, MODELS, providerModelFor, normalizeModelKey } from '../src/core/models.ts';
import { routeRejection, routeScore, type RouteRequirement } from '../src/core/aspect.ts';

const req = (over: Partial<RouteRequirement> = {}): RouteRequirement => ({
  aspect: '1:1',
  size: '1K',
  sizeIsExplicit: false,
  mode: 'generate',
  referenceCount: 0,
  ...over,
});

const route = (modelId: string, transport: any) => {
  const caps = resolveModel(modelId)!.routes[transport];
  assert.ok(caps, `${modelId} has no ${transport} route`);
  return caps!;
};

describe('model name resolution', () => {
  it('matches ignoring case, spaces, and punctuation', () => {
    for (const n of ['GPT Image', 'gpt-image', 'gptimage', 'GPT_IMAGE', 'gpt image 2']) {
      assert.equal(resolveModel(n)?.id, 'gpt-image-2', `"${n}" should resolve to gpt-image-2`);
    }
    for (const n of ['Nano Banana', 'nano-banana', 'nanobanana', 'NB', 'full']) {
      assert.equal(resolveModel(n)?.id, 'nb2', `"${n}" should resolve to nb2`);
    }
  });

  it('never resolves a family name to a retired model', () => {
    // The v5 table pointed `gpt` at GPT-5 Image and `mini` at GPT-5 Image Mini,
    // both built on the GPT Image 1 stack OpenAI is retiring. A user or agent
    // saying "use gpt" must always get the CURRENT model.
    for (const n of ['gpt', 'gpt5', 'gpt-5-image', 'mini', 'gpt54', 'openai', 'chatgpt']) {
      assert.equal(resolveModel(n)?.id, 'gpt-image-2', `"${n}" must resolve forward, not to a retired model`);
    }
    // Nano Banana Pro is Gemini 3 Pro Image — a generation behind nb2's Gemini
    // 3.1 — so it was removed. `pro` means "the best current Nano Banana" and
    // must resolve forward rather than 404 or pin an old model.
    for (const n of ['pro', 'nb-pro', 'nb2-pro', 'nano banana pro']) {
      assert.equal(resolveModel(n)?.id, 'nb2', `"${n}" must resolve to the current best model`);
    }
    assert.equal(resolveModel('nb2-lite')?.id, 'nb-lite');
  });

  it('returns null for genuinely unknown names', () => {
    assert.equal(resolveModel('dall-e-2'), null);
    assert.equal(resolveModel(''), null);
  });

  it('has no alias colliding across two models', () => {
    const seen = new Map<string, string>();
    for (const m of MODELS) {
      for (const a of [m.id, ...m.aliases]) {
        const k = normalizeModelKey(a);
        const prev = seen.get(k);
        assert.ok(prev === undefined || prev === m.id, `alias "${a}" claimed by both ${prev} and ${m.id}`);
        seen.set(k, m.id);
      }
    }
  });
});

describe('route rejection', () => {
  it('excludes the fixed-budget Codex route from explicit 2K/4K', () => {
    const codex = route('gpt-image-2', 'codex-oauth');
    assert.match(routeRejection(codex, req({ size: '4K', sizeIsExplicit: true }))!, /fixed at ~1\.5\d megapixels/);
    assert.match(routeRejection(codex, req({ size: '2K', sizeIsExplicit: true }))!, /fixed at/);
  });

  it('still allows Codex when no size was pinned', () => {
    const codex = route('gpt-image-2', 'codex-oauth');
    assert.equal(routeRejection(codex, req()), null);
    // ...including for 16:9, which v5 refused outright.
    assert.equal(routeRejection(codex, req({ aspect: '16:9' })), null);
  });

  it('excludes Codex when medium/high quality is demanded', () => {
    const codex = route('gpt-image-2', 'codex-oauth');
    assert.match(routeRejection(codex, req({ quality: 'high' }))!, /forces quality=low/);
    assert.equal(routeRejection(codex, req({ quality: 'low' })), null);
  });

  it('rejects more reference images than a route accepts', () => {
    const lite = route('nb-lite', 'gemini-direct');
    assert.equal(routeRejection(lite, req({ referenceCount: 14 })), null);
    assert.match(routeRejection(lite, req({ referenceCount: 15 }))!, /at most 14 reference/);
  });

  it('accepts 4K on nb2 but rejects it on 1K-only nb-lite', () => {
    const r = req({ size: '4K', sizeIsExplicit: true });
    assert.equal(routeRejection(route('nb2', 'gemini-direct'), r), null);
    assert.equal(routeRejection(route('nb2', 'openrouter'), r), null);
    assert.match(routeRejection(route('nb-lite', 'gemini-direct'), r)!, /does not support size 4K/);
  });
});

describe('route ranking', () => {
  it('prefers the free route when it satisfies the request', () => {
    const codex = routeScore(route('gpt-image-2', 'codex-oauth'), false);
    const paid = routeScore(route('nb-lite', 'openrouter'), false);
    assert.ok(codex > paid, 'a plain 1K request must not silently spend money');
  });

  it('prefers an exact route when a specific aspect was requested', () => {
    // The Codex frame is prompt-steered and only approximate, so paying for an
    // exact frame is the right call once the caller names a ratio.
    const codex = routeScore(route('gpt-image-2', 'codex-oauth'), true);
    const exact = routeScore(route('nb2', 'gemini-direct'), true);
    assert.ok(exact > codex, 'an explicit --ar should win an exact route');
  });
});

describe('provider model selection', () => {
  it('uses the -preview id for 4K on OpenRouter and the stable id otherwise', () => {
    // OpenRouter's stable Gemini ids hard-reject 4K; only the preview ids serve it.
    const or = route('nb2', 'openrouter');
    assert.match(providerModelFor(or, '4K'), /-preview$/);
    assert.ok(!providerModelFor(or, '1K').includes('preview'));
    assert.ok(!providerModelFor(or, '2K').includes('preview'));
  });

  it('never routes to openai/gpt-image-2, which has no image endpoint', () => {
    for (const m of MODELS) {
      for (const c of Object.values(m.routes)) {
        const ids = [c.providerModel, ...Object.values(c.providerModelBySize ?? {})];
        assert.ok(!ids.includes('openai/gpt-image-2'), `${m.id} routes to a dead provider id`);
      }
    }
  });

  it('ships no model from a superseded generation', () => {
    // Policy: never keep an old model reachable. Every Gemini route must be on
    // the current 3.1 generation — gemini-3-pro-image (Nano Banana Pro, Nov
    // 2025) and gemini-2.5-flash-image are a generation behind and are gone.
    for (const m of MODELS) {
      for (const c of Object.values(m.routes)) {
        const ids = [c.providerModel, ...Object.values(c.providerModelBySize ?? {})];
        for (const id of ids) {
          assert.ok(!id.includes('gemini-3-pro-image'), `${m.id} still routes to Nano Banana Pro: ${id}`);
          assert.ok(!id.includes('gemini-2.5'), `${m.id} still routes to a 2.5-era model: ${id}`);
        }
      }
    }
  });
});
