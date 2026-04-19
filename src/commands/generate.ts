import path from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { dispatch } from '../core/dispatch.js';
import { autoName } from '../lib/naming.js';
import { createOutput, type Output } from '../lib/output.js';
import { normalizeError, NB2Error } from '../lib/errors.js';

export interface GenerateCommandOpts {
  output?: string;
  ar: string;
  size: string;
  pro: boolean;
  model?: string;
  via?: string;
  neg?: string;
  ref?: string[];
  open: boolean;
  json: boolean;
  quiet: boolean;
}

export async function runGenerate(prompt: string, opts: GenerateCommandOpts): Promise<void> {
  const out: Output = createOutput(opts.json, opts.quiet);

  if (!prompt) {
    const err = new NB2Error('PROMPT_MISSING', 'No prompt provided. Usage: nanaban "your prompt"');
    out.error(err);
    process.exit(err.exitCode);
  }

  try {
    out.spin('Generating image...');

    const result = await dispatch({
      mode: 'generate',
      prompt,
      modelName: opts.model,
      pro: opts.pro,
      via: opts.via,
      aspect: opts.ar,
      size: opts.size,
      negativePrompt: opts.neg,
      referenceImages: opts.ref?.map(p => ({ source: 'file' as const, path: p })),
      basePath: process.cwd(),
    });

    out.info(`Auth: ${result.authMethod}`);

    const dir = process.cwd();
    const filename = opts.output || await autoName(prompt, dir);
    const filePath = path.resolve(dir, filename);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, result.buffer);

    out.stopSpin();
    out.success({
      file: filePath,
      model: result.modelId,
      transport: result.transport,
      width: result.width,
      height: result.height,
      sizeBytes: result.buffer.length,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      fallbacks: result.fallbacks,
    });

    if (opts.open) {
      const { execFile } = await import('child_process');
      execFile('open', [filePath]);
    }
  } catch (err) {
    out.stopSpin();
    const nerr = normalizeError(err);
    out.error(nerr);
    process.exit(nerr.exitCode);
  }
}
