import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

const CONFIG_DIR = path.join(homedir(), '.nanaban');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface NB2Config {
  apiKey?: string;
  openRouterKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
}

export async function readConfig(): Promise<NB2Config> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export async function readConfigWithPath(): Promise<{ config: NB2Config; path: string | null }> {
  const config = await readConfig();
  const hasAny = Object.keys(config).length > 0;
  return { config, path: hasAny ? '~/.nanaban/config.json' : null };
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
