import { dispatch, type DispatchResult } from '../core/dispatch.js';
import { saveImage } from '../lib/save.js';
import { createOutput, type Output } from '../lib/output.js';
import { normalizeError } from '../lib/errors.js';

export interface GenerateCommandOpts {
  output?: string;
  ar?: string;
  size?: string;
  quality?: string;
  model?: string;
  via?: string;
  neg?: string;
  ref?: string[];
  open: boolean;
  json: boolean;
  quiet: boolean;
}

export async function openInViewer(filePath: string): Promise<void> {
  const { execFile } = await import('child_process');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execFile(opener, [filePath], () => { /* best-effort; never crash after a successful save */ });
}

export async function reportSuccess(
  out: Output,
  result: DispatchResult,
  filePath: string,
  extra?: { operation?: string; method?: string; engine?: string; contentPreservation?: string; scale?: number; warnings?: string[] },
): Promise<void> {
  out.stopSpin();
  out.success({
    file: filePath,
    model: result.model.id,
    providerModel: result.modelId,
    transport: result.transport,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    sizeBytes: result.buffer.length,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    fallbacks: result.fallbacks,
    aspectFulfillment: result.aspectFulfillment,
    costEstimated: result.costEstimated,
    warnings: result.warnings?.length ? result.warnings : undefined,
    ...extra,
  });
}

export async function runGenerate(prompt: string, opts: GenerateCommandOpts): Promise<void> {
  const out: Output = createOutput(opts.json, opts.quiet);

  try {
    out.spin('Generating image...');

    const result = await dispatch({
      mode: 'generate',
      prompt,
      modelName: opts.model,
      quality: opts.quality,
      via: opts.via,
      aspect: opts.ar,
      size: opts.size,
      negativePrompt: opts.neg,
      referenceImages: opts.ref?.map(p => ({ source: 'file' as const, path: p })),
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
