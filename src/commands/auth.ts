import { detectAuth, type AuthState } from '../core/auth.js';
import { setStoredKey, setStoredOpenRouterKey } from '../lib/config.js';
import { MODELS, type ModelInfo } from '../core/models.js';
import { createOutput } from '../lib/output.js';
import pc from 'picocolors';

interface AuthMethodView {
  type: 'gemini' | 'openrouter';
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
  return out;
}

function reachableModels(state: AuthState): { model: ModelInfo; transports: string[] }[] {
  return MODELS.map(model => {
    const transports: string[] = [];
    if (state.gemini && model.ids['gemini-direct']) transports.push('gemini-direct');
    if (state.openRouter && model.ids['openrouter']) transports.push('openrouter');
    return { model, transports };
  }).filter(r => r.transports.length > 0);
}

export async function runAuthStatus(json: boolean): Promise<void> {
  const state = await detectAuth();
  const methods = viewAuth(state);
  const reachable = reachableModels(state);

  if (json) {
    const status = methods.length === 0 ? 'none' : 'ok';
    process.stdout.write(JSON.stringify({
      status,
      methods,
      reachable_models: reachable.map(r => ({ id: r.model.id, transports: r.transports })),
    }) + '\n');
    if (methods.length === 0) process.exit(1);
    return;
  }

  const out = createOutput(false, false);
  if (methods.length === 0) {
    out.authStatus('none', 'No authentication configured. Run `nanaban auth set <gemini-key>` or `nanaban auth set-openrouter <key>`, or set GEMINI_API_KEY / OPENROUTER_API_KEY.', false);
    process.exit(1);
  }

  for (const m of methods) {
    out.authStatus(`${m.type}/${m.source}`, m.detail, m.valid);
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
