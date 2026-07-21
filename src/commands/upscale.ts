import path from 'path';
import { dispatchUpscale } from '../core/upscale.js';
import { saveImage } from '../lib/save.js';
import { createOutput, type Output } from '../lib/output.js';
import { normalizeError, NB2Error } from '../lib/errors.js';
import { openInViewer } from './generate.js';

export interface UpscaleCommandOpts {
  scale: string;
  engine: string;
  model?: string;
  faceEnhance: boolean;
  output?: string;
  json: boolean;
  quiet: boolean;
  open: boolean;
}

const ENGINES = new Set(['auto', 'real-esrgan', 'crisp', 'rerender']);

export async function runUpscale(imagePath: string, opts: UpscaleCommandOpts): Promise<void> {
  const out: Output = createOutput(opts.json, opts.quiet);

  try {
    if (!ENGINES.has(opts.engine)) {
      throw new NB2Error('BAD_ARGUMENT', `Unknown engine "${opts.engine}". Use: auto, real-esrgan, crisp, rerender`);
    }
    const scale = Number(opts.scale);

    out.spin('Upscaling image...');

    const result = await dispatchUpscale({
      imagePath,
      scale,
      engine: opts.engine as any,
      modelName: opts.model,
      faceEnhance: opts.faceEnhance,
      basePath: process.cwd(),
    });

    const stem = path.basename(imagePath, path.extname(imagePath));
    const filePath = await saveImage(result.buffer, {
      outputPath: opts.output,
      prompt: `${stem} upscaled ${scale}x`,
      mimeType: result.mimeType,
    });

    out.stopSpin();
    out.success({
      file: filePath,
      model: result.model,
      providerModel: result.providerModel,
      transport: result.transport,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
      sizeBytes: result.buffer.length,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      operation: 'upscale',
      method: result.method,
      engine: result.engine,
      contentPreservation: result.contentPreservation,
      scale,
      warnings: result.warnings,
    });

    if (opts.open) await openInViewer(filePath);
  } catch (err) {
    out.stopSpin();
    const nerr = normalizeError(err);
    out.error(nerr);
    process.exitCode = nerr.exitCode;
  }
}
