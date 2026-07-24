import { access } from 'fs/promises';
import path from 'path';
import { dispatch } from '../core/dispatch.js';
import { saveImage } from '../lib/save.js';
import { createOutput, type Output } from '../lib/output.js';
import { normalizeError, NB2Error } from '../lib/errors.js';
import { reportSuccess, openInViewer } from './generate.js';

export interface EditCommandOpts {
  output?: string;
  /** No default: undefined means "match the source image's aspect ratio". */
  ar?: string;
  size?: string;
  quality?: string;
  model?: string;
  via?: string;
  neg?: string;
  json: boolean;
  quiet: boolean;
  open: boolean;
}

export async function runEdit(imagePath: string, prompt: string, opts: EditCommandOpts): Promise<void> {
  const out: Output = createOutput(opts.json, opts.quiet);

  const resolved = path.resolve(imagePath);
  try {
    await access(resolved);
  } catch {
    const err = new NB2Error('IMAGE_NOT_FOUND', `Image not found: ${resolved}`);
    out.error(err);
    process.exitCode = err.exitCode;
    return;
  }

  try {
    out.spin('Editing image...');

    const result = await dispatch({
      mode: 'edit',
      prompt,
      modelName: opts.model,
      quality: opts.quality,
      via: opts.via,
      aspect: opts.ar,
      size: opts.size,
      negativePrompt: opts.neg,
      referenceImages: [{ source: 'file', path: resolved }],
      basePath: process.cwd(),
    });

    out.info(`Auth: ${result.authMethod}`);

    const filePath = await saveImage(result.buffer, {
      outputPath: opts.output,
      prompt,
      mimeType: result.mimeType,
    });

    await reportSuccess(out, result, filePath);
    if (opts.open) await openInViewer(filePath);
  } catch (err) {
    out.stopSpin();
    const nerr = normalizeError(err);
    out.error(nerr);
    process.exitCode = nerr.exitCode;
  }
}
