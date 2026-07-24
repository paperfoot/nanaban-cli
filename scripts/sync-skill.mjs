#!/usr/bin/env node
// Regenerate the embedded SKILL_CONTENT constant from the canonical SKILL.md.
// Run after editing SKILL.md; `npm test` fails if they drift.
import { readFile, writeFile } from 'fs/promises';

const skill = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
const esc = skill.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const path = new URL('../src/commands/skill.ts', import.meta.url);
const src = await readFile(path, 'utf8');
const start = src.indexOf('export const SKILL_CONTENT = `');
const end = src.indexOf('`;', start) + 2;
if (start === -1) throw new Error('SKILL_CONTENT marker not found');
await writeFile(path, src.slice(0, start) + 'export const SKILL_CONTENT = `' + esc + '`;' + src.slice(end));
console.log(`synced ${skill.length} chars from SKILL.md`);
