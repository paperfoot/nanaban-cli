import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGenAI } from '@google/genai';
import { readConfig, readConfigWithPath } from '../lib/config.js';
import { NB2Error } from '../lib/errors.js';
import type { ModelInfo, TransportId } from './models.js';
import { TRANSPORT_PREFERENCE } from './models.js';

export type KeyedSource =
  | { type: 'env'; key: string; name: string }
  | { type: 'config'; key: string; path: string };

export type GeminiSource =
  | KeyedSource
  | { type: 'oauth'; client: OAuth2Client; path: string };

export type AuthSource = GeminiSource;

export interface CodexSource {
  type: 'codex';
  accessToken: string;
  accountId: string;
  path: string;
}

export interface AuthState {
  gemini: GeminiSource | null;
  openRouter: KeyedSource | null;
  codex: CodexSource | null;
}

async function getOAuthClient(): Promise<OAuth2Client | null> {
  const config = await readConfig();
  const clientId = process.env.NANABAN_OAUTH_CLIENT_ID || config.oauthClientId;
  const clientSecret = process.env.NANABAN_OAUTH_CLIENT_SECRET || config.oauthClientSecret;
  if (!clientId || !clientSecret) return null;

  const oauthPath = path.join(homedir(), '.gemini', 'oauth_creds.json');
  try {
    const raw = await fs.readFile(oauthPath, 'utf-8');
    const creds = JSON.parse(raw);
    const oauth2Client = new OAuth2Client({ clientId, clientSecret });
    oauth2Client.setCredentials(creds);
    const { token } = await oauth2Client.getAccessToken();
    if (!token) return null;
    return oauth2Client;
  } catch {
    return null;
  }
}

export async function detectAuth(): Promise<AuthState> {
  const state: AuthState = { gemini: null, openRouter: null, codex: null };

  const envGemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (envGemini) {
    state.gemini = {
      type: 'env',
      key: envGemini,
      name: process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
    };
  } else {
    const { config, path: configPath } = await readConfigWithPath();
    if (config.apiKey && configPath) {
      state.gemini = { type: 'config', key: config.apiKey, path: configPath };
    } else {
      const oauth = await getOAuthClient();
      if (oauth) {
        state.gemini = { type: 'oauth', client: oauth, path: '~/.gemini/oauth_creds.json' };
      }
    }
  }

  const envOR = process.env.OPENROUTER_API_KEY;
  if (envOR) {
    state.openRouter = { type: 'env', key: envOR, name: 'OPENROUTER_API_KEY' };
  } else {
    const { config, path: configPath } = await readConfigWithPath();
    if (config.openRouterKey && configPath) {
      state.openRouter = { type: 'config', key: config.openRouterKey, path: configPath };
    }
  }

  // ~/.codex/auth.json written by `codex login`. Shape:
  //   { auth_mode, OPENAI_API_KEY, tokens: { id_token, access_token, refresh_token, account_id }, last_refresh }
  const codexPath = path.join(homedir(), '.codex', 'auth.json');
  try {
    const raw = await fs.readFile(codexPath, 'utf-8');
    const parsed = JSON.parse(raw) as { tokens?: { access_token?: string; account_id?: string } };
    const accessToken = parsed.tokens?.access_token;
    const accountId = parsed.tokens?.account_id;
    if (accessToken && accountId) {
      state.codex = {
        type: 'codex',
        accessToken,
        accountId,
        path: '~/.codex/auth.json',
      };
    }
  } catch {
    // ignore missing or malformed codex auth
  }

  return state;
}

export function transportAvailable(t: TransportId, auth: AuthState): boolean {
  if (t === 'gemini-direct') return auth.gemini !== null;
  if (t === 'openrouter') return auth.openRouter !== null;
  if (t === 'codex-oauth') return auth.codex !== null;
  return false;
}

export interface ResolvedRoute {
  transport: TransportId;
  modelId: string;
  authKey?: string;
  oauthClient?: OAuth2Client;
  codexToken?: string;
  codexAccountId?: string;
}

// Single source of truth for "assemble a concrete route for (model, auth, transport)".
// Returns null if the model has no mapping on this transport OR the transport has
// no configured auth. dispatch.ts (auto fallback chain) and resolveRoute (explicit
// --via) both call through this so they can never drift out of sync.
export function buildRoute(model: ModelInfo, auth: AuthState, t: TransportId): ResolvedRoute | null {
  const modelId = model.ids[t];
  if (!modelId) return null;
  if (!transportAvailable(t, auth)) return null;
  if (t === 'gemini-direct') {
    const g = auth.gemini!;
    if (g.type === 'oauth') return { transport: t, modelId, oauthClient: g.client };
    return { transport: t, modelId, authKey: g.key };
  }
  if (t === 'codex-oauth') {
    const c = auth.codex!;
    return { transport: t, modelId, codexToken: c.accessToken, codexAccountId: c.accountId };
  }
  return { transport: t, modelId, authKey: auth.openRouter!.key };
}

// Enumerate every reachable route for a model, in TRANSPORT_PREFERENCE order.
// Used by the auto-fallback chain in dispatch.ts.
export function routesForModel(model: ModelInfo, auth: AuthState): ResolvedRoute[] {
  const out: ResolvedRoute[] = [];
  for (const t of TRANSPORT_PREFERENCE) {
    const r = buildRoute(model, auth, t);
    if (r) out.push(r);
  }
  return out;
}

// Human-readable description of what the user would need to reach this model.
// Used in error messages; kept in one place so copy stays consistent.
export function needsForTransport(t: TransportId): string {
  if (t === 'gemini-direct') return 'GEMINI_API_KEY';
  if (t === 'openrouter') return 'OPENROUTER_API_KEY';
  if (t === 'codex-oauth') return 'Codex OAuth (run `codex login`)';
  return t;
}

export function needsForModel(model: ModelInfo): string[] {
  return Object.keys(model.ids).map(t => needsForTransport(t as TransportId));
}

export function resolveRoute(model: ModelInfo, auth: AuthState, forced?: TransportId): ResolvedRoute {
  if (forced) {
    const r = buildRoute(model, auth, forced);
    if (!r) {
      const reason = !model.ids[forced]
        ? `${model.id} cannot run on ${forced}`
        : `${forced} requires ${needsForTransport(forced)}`;
      throw new NB2Error('TRANSPORT_UNAVAILABLE', reason);
    }
    return r;
  }

  for (const t of TRANSPORT_PREFERENCE) {
    const r = buildRoute(model, auth, t);
    if (r) return r;
  }

  throw new NB2Error(
    'AUTH_MISSING',
    `Cannot reach ${model.display}: requires one of ${needsForModel(model).join(' or ')}.`,
  );
}

export function makeGeminiClient(auth: AuthState): GoogleGenAI {
  if (!auth.gemini) throw new NB2Error('AUTH_MISSING', 'No Gemini auth configured');
  if (auth.gemini.type === 'oauth') {
    return new GoogleGenAI({ googleAuthOptions: { authClient: auth.gemini.client as any } });
  }
  return new GoogleGenAI({ apiKey: auth.gemini.key });
}
