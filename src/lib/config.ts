import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

// slika was named nanaban through v4.x. Reads fall back to the legacy
// ~/.nanaban/config.json so existing installs keep working; writes always
// go to ~/.slika (migrating the merged config forward on first write).
const CONFIG_DIR = path.join(homedir(), '.slika');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LEGACY_CONFIG_PATH = path.join(homedir(), '.nanaban', 'config.json');

export interface NB2Config {
  apiKey?: string;
  openRouterKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

async function readJson(p: string): Promise<NB2Config | null> {
  try {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return null;
  }
}

export async function readConfigWithPath(): Promise<{ config: NB2Config; path: string | null }> {
  const current = await readJson(CONFIG_PATH);
  if (current) return { config: current, path: '~/.slika/config.json' };
  const legacy = await readJson(LEGACY_CONFIG_PATH);
  if (legacy) return { config: legacy, path: '~/.nanaban/config.json' };
  return { config: {}, path: null };
}

export async function readConfig(): Promise<NB2Config> {
  return (await readConfigWithPath()).config;
}

export async function writeConfig(config: NB2Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

export async function getStoredKey(): Promise<string | undefined> {
  return (await readConfig()).apiKey;
}

export async function setStoredKey(key: string): Promise<void> {
  const config = await readConfig();
  config.apiKey = key;
  await writeConfig(config);
}

export async function getStoredOpenRouterKey(): Promise<string | undefined> {
  return (await readConfig()).openRouterKey;
}

export async function setStoredOpenRouterKey(key: string): Promise<void> {
  const config = await readConfig();
  config.openRouterKey = key;
  await writeConfig(config);
}
