import pc from 'picocolors';
import { createSpinner } from 'nanospinner';
import type { Spinner } from 'nanospinner';
import type { NB2Error } from './errors.js';

export interface FallbackHop {
  transport: string;
  code: string;
  message: string;
}

export interface GenerateResult {
  file: string;
  model: string;
  transport: string;
  width: number;
  height: number;
  sizeBytes: number;
  durationMs: number;
  costUsd?: number;
  fallbacks?: FallbackHop[];
}

export interface Output {
  spin(text: string): void;
  stopSpin(): void;
  success(result: GenerateResult): void;
  error(err: NB2Error): void;
  info(text: string): void;
  authStatus(method: string, detail: string, valid: boolean): void;
}

export class HumanOutput implements Output {
  private spinner: Spinner | null = null;
  private quiet: boolean;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  spin(text: string): void {
    if (this.quiet) return;
    this.spinner = createSpinner(text).start();
  }

  stopSpin(): void {
    this.spinner?.stop();
    this.spinner = null;
  }

  success(r: GenerateResult): void {
    this.spinner?.success({ text: pc.bold(r.file) });
    this.spinner = null;
    if (!this.quiet) {
      const kb = Math.round(r.sizeBytes / 1024);
      const sec = (r.durationMs / 1000).toFixed(1);
      const cost = r.costUsd !== undefined ? ` | $${r.costUsd.toFixed(4)}` : '';
      const meta = pc.dim(`     ${r.width}x${r.height} | ${kb} KB | ${sec}s${cost} | ${r.model} (${r.transport})`);
      process.stderr.write(meta + '\n');
      if (r.fallbacks?.length) {
        for (const f of r.fallbacks) {
          process.stderr.write(pc.yellow(`     fell back: ${f.transport} failed with ${f.code}, retried on ${r.transport}`) + '\n');
        }
      }
    }
    process.stdout.write(r.file + '\n');
  }

  error(err: NB2Error): void {
    if (this.spinner) {
      this.spinner.error({ text: pc.red(err.message) });
      this.spinner = null;
    } else {
      process.stderr.write(pc.red(`Error: ${err.message}`) + '\n');
    }
    process.stderr.write(pc.dim(`     code: ${err.code}`) + '\n');
    const hint = hintFor(err.code);
    if (hint) process.stderr.write(pc.dim(`     hint: ${hint}`) + '\n');
  }

  info(text: string): void {
    if (!this.quiet) process.stderr.write(pc.dim(text) + '\n');
  }

  authStatus(method: string, detail: string, valid: boolean): void {
    const icon = valid ? pc.green('OK') : pc.red('FAIL');
    process.stderr.write(`${icon} ${pc.bold(method)}: ${detail}\n`);
  }
}

export class JsonOutput implements Output {
  spin(_text: string): void {}
  stopSpin(): void {}

  success(r: GenerateResult): void {
    const out: Record<string, unknown> = {
      status: 'success',
      file: r.file,
      model: r.model,
      transport: r.transport,
      dimensions: { width: r.width, height: r.height },
      size_bytes: r.sizeBytes,
      duration_ms: r.durationMs,
    };
    if (r.costUsd !== undefined) out.cost_usd = r.costUsd;
    if (r.fallbacks?.length) out.fallbacks = r.fallbacks;
    process.stdout.write(JSON.stringify(out) + '\n');
  }

  error(err: NB2Error): void {
    const payload: Record<string, unknown> = { status: 'error', code: err.code, message: err.message };
    const hint = hintFor(err.code);
    if (hint) payload.hint = hint;
    process.stdout.write(JSON.stringify(payload) + '\n');
  }

  info(_text: string): void {}

  authStatus(method: string, detail: string, valid: boolean): void {
    process.stdout.write(JSON.stringify({ method, detail, valid }) + '\n');
  }
}

export function createOutput(json: boolean, quiet: boolean): Output {
  return json ? new JsonOutput() : new HumanOutput(quiet);
}

function hintFor(code: string): string | null {
  switch (code) {
    case 'AUTH_MISSING':
      return 'pick one: `codex login` (free gpt-image-2 via ChatGPT Plus/Pro) | `nanaban auth set-openrouter <key>` (one key reaches every OR-routed model) | set GEMINI_API_KEY / OPENROUTER_API_KEY.';
    case 'AUTH_INVALID':
      return 'key or OAuth token was rejected. Refresh: Codex → `codex login`; OpenRouter → https://openrouter.ai/keys; Gemini → https://aistudio.google.com/apikey';
    case 'AUTH_EXPIRED':
      return 'OAuth token expired. Re-auth with `codex login` (for codex-oauth) or `gemini auth` (for gemini-direct), or set OPENROUTER_API_KEY to bypass OAuth entirely.';
    case 'RATE_LIMITED':
      return 'add a second provider so nanaban can fall back automatically: `nanaban auth set-openrouter <key>` or set OPENROUTER_API_KEY.';
    case 'NETWORK_ERROR':
      return 'transient network or upstream failure. Retry, or add a second provider for automatic failover.';
    case 'TRANSPORT_UNAVAILABLE':
      return 'the requested model cannot be reached with the auth you have. Run `nanaban auth` to see what IS reachable.';
    case 'CAPABILITY_UNSUPPORTED':
      return 'run `nanaban agent-info` to see each model\'s supported aspect ratios, sizes, and features.';
    case 'MODEL_NOT_FOUND':
      return 'run `nanaban agent-info` for the list of valid model ids and aliases.';
    default:
      return null;
  }
}
