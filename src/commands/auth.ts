import { detectAuth, type AuthState } from '../core/auth.js';
import { setStoredKey, setStoredOpenRouterKey } from '../lib/config.js';
import { MODELS, type ModelInfo } from '../core/models.js';
import { createOutput } from '../lib/output.js';
import pc from 'picocolors';

interface AuthMethodView {
  type: 'gemini' | 'openrouter' | 'codex-oauth';
  source: string;
  detail: string;
  valid: boolean;
}

function viewAuth(state: AuthState): AuthMethodView[] {
  const out: AuthMethodView[] = [];
  if (state.gemini) {
    const g = state.gemini;
    let detail: string;
    if (g.type === 'env') detail = `${g.name}=${g.key.slice(0, 8)}...`;
    else if (g.type === 'config') detail = `${g.path} (${g.key.slice(0, 8)}...)`;
    else detail = g.path;
    out.push({ type: 'gemini', source: g.type, detail, valid: true });
  }
  if (state.openRouter) {
    const o = state.openRouter;
    const detail = o.type === 'env' ? `${o.name}=${o.key.slice(0, 12)}...`
      : `${o.path} (${o.key.slice(0, 12)}...)`;
    out.push({ type: 'openrouter', source: o.type, detail, valid: true });
  }
  if (state.codex) {
    out.push({
      type: 'codex-oauth',
      source: 'file',
      detail: `${state.codex.path} (account ${state.codex.accountId.slice(0, 8)}...)`,
      valid: true,
    });
  }
  return out;
}

function reachableModels(state: AuthState): { model: ModelInfo; transports: string[] }[] {
  return MODELS.map(model => {
    const transports: string[] = [];
    if (state.codex && model.ids['codex-oauth']) transports.push('codex-oauth');
    if (state.openRouter && model.ids['openrouter']) transports.push('openrouter');
    if (state.gemini && model.ids['gemini-direct']) transports.push('gemini-direct');
    return { model, transports };
  }).filter(r => r.transports.length > 0);
}

interface CheckResult {
  type: 'gemini' | 'openrouter' | 'codex-oauth';
  ok: boolean;
  detail: string;
  credits_remaining_usd?: number;
}

// Live-probe each configured credential. `nanaban auth` without --check only
// reports what is configured; keys can be present but revoked/expired, so
// agents should run `auth --check` before assuming a transport works.
async function liveCheck(state: AuthState): Promise<CheckResult[]> {
  const checks: Promise<CheckResult>[] = [];

  if (state.gemini) {
    const g = state.gemini;
    if (g.type === 'oauth') {
      // detectAuth already exchanged the refresh token for an access token.
      checks.push(Promise.resolve({ type: 'gemini', ok: true, detail: 'OAuth token refreshed successfully' }));
    } else {
      checks.push((async (): Promise<CheckResult> => {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${g.key}`);
          if (res.ok) return { type: 'gemini', ok: true, detail: 'API key accepted' };
          const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
          return { type: 'gemini', ok: false, detail: body.error?.message || `HTTP ${res.status}` };
        } catch (err: any) {
          return { type: 'gemini', ok: false, detail: `probe failed: ${err.message}` };
        }
      })());
    }
  }

  if (state.openRouter) {
    const key = state.openRouter.key;
    checks.push((async (): Promise<CheckResult> => {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) return { type: 'openrouter', ok: false, detail: `HTTP ${res.status}` };
        const body = await res.json() as { data?: { total_credits?: number; total_usage?: number } };
        const remaining = (body.data?.total_credits ?? 0) - (body.data?.total_usage ?? 0);
        return {
          type: 'openrouter',
          ok: true,
          detail: `key accepted, $${remaining.toFixed(2)} credits remaining`,
          credits_remaining_usd: Math.round(remaining * 100) / 100,
        };
      } catch (err: any) {
        return { type: 'openrouter', ok: false, detail: `probe failed: ${err.message}` };
      }
    })());
  }

  if (state.codex) {
    const token = state.codex.accessToken;
    checks.push((async (): Promise<CheckResult> => {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp?: number };
        if (!payload.exp) return { type: 'codex-oauth', ok: true, detail: 'token present (no expiry claim)' };
        const expires = new Date(payload.exp * 1000);
        const ok = expires.getTime() > Date.now();
        return {
          type: 'codex-oauth',
          ok,
          detail: ok
            ? `token valid until ${expires.toISOString()}`
            : `token expired ${expires.toISOString()} — run \`codex login\` (or any codex command) to refresh`,
        };
      } catch {
        return { type: 'codex-oauth', ok: false, detail: 'could not decode access token — run `codex login`' };
      }
    })());
  }

  return Promise.all(checks);
}

export async function runAuthStatus(json: boolean, check = false): Promise<void> {
  const state = await detectAuth();
  const methods = viewAuth(state);
  const reachable = reachableModels(state);
  const checks = check ? await liveCheck(state) : null;

  if (checks) {
    for (const m of methods) {
      const c = checks.find(c => c.type === m.type);
      if (c) m.valid = c.ok;
    }
  }

  if (json) {
    const anyFailed = checks?.some(c => !c.ok) ?? false;
    const status = methods.length === 0 ? 'none' : anyFailed ? 'degraded' : 'ok';
    process.stdout.write(JSON.stringify({
      status,
      methods,
      ...(checks ? { checks } : {}),
      reachable_models: reachable.map(r => ({ id: r.model.id, transports: r.transports })),
    }) + '\n');
    if (methods.length === 0) process.exit(1);
    return;
  }

  const out = createOutput(false, false);
  if (methods.length === 0) {
    out.authStatus('none', 'No authentication configured. Options: run `codex login` (free via ChatGPT Plus/Pro → gpt-image-2), `nanaban auth set-openrouter <key>` (all models via OpenRouter), or set GEMINI_API_KEY / OPENROUTER_API_KEY.', false);
    process.exit(1);
  }

  for (const m of methods) {
    const c = checks?.find(c => c.type === m.type);
    const detail = c ? `${m.detail} — ${c.detail}` : m.detail;
    out.authStatus(`${m.type}/${m.source}`, detail, m.valid);
  }

  process.stderr.write('\n' + pc.bold('Reachable models:') + '\n');
  for (const r of reachable) {
    process.stderr.write(`  ${pc.cyan(r.model.id.padEnd(10))} ${pc.dim(r.model.display)}  via ${r.transports.join(', ')}\n`);
  }
}

export async function runAuthSet(key: string, json: boolean): Promise<void> {
  if (!key) {
    if (json) process.stdout.write(JSON.stringify({ status: 'error', code: 'USAGE', message: 'No key provided. Usage: nanaban auth set <key>' }) + '\n');
    else createOutput(false, false).authStatus('config', 'No key provided. Usage: nanaban auth set <key>', false);
    process.exit(2);
  }
  await setStoredKey(key);
  if (json) process.stdout.write(JSON.stringify({ status: 'ok', message: 'Gemini API key saved to ~/.nanaban/config.json' }) + '\n');
  else createOutput(false, false).authStatus('config', 'Gemini API key saved to ~/.nanaban/config.json', true);
}

export async function runAuthSetOpenRouter(key: string, json: boolean): Promise<void> {
  if (!key) {
    if (json) process.stdout.write(JSON.stringify({ status: 'error', code: 'USAGE', message: 'No key provided. Usage: nanaban auth set-openrouter <key>' }) + '\n');
    else createOutput(false, false).authStatus('config', 'No key provided. Usage: nanaban auth set-openrouter <key>', false);
    process.exit(2);
  }
  await setStoredOpenRouterKey(key);
  if (json) process.stdout.write(JSON.stringify({ status: 'ok', message: 'OpenRouter key saved to ~/.nanaban/config.json' }) + '\n');
  else createOutput(false, false).authStatus('config', 'OpenRouter key saved to ~/.nanaban/config.json', true);
}
