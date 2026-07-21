import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { autoName, slugFromPrompt } from './naming.js';
import { extensionForMime } from './image-meta.js';
import { NB2Error } from './errors.js';

// Shared by generate / edit / upscale: name the file, write atomically, and
// never lose a paid image to a local write failure.

export interface SaveOptions {
  outputPath?: string;
  prompt: string;
  mimeType: string;
}

async function writeAtomic(filePath: string, buffer: Buffer, exclusive: boolean): Promise<void> {
  // tmp + rename: a killed process never leaves a truncated file at the
  // advertised path, and rename is atomic on the same filesystem.
  const tmp = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, buffer);
  try {
    if (exclusive) {
      // Claim the destination without clobbering a concurrent writer.
      await fs.link(tmp, filePath);
      await fs.unlink(tmp);
    } else {
      await fs.rename(tmp, filePath);
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Write the image and return its absolute path. Auto-named files are claimed
 * exclusively (two concurrent nanaban processes can never overwrite each
 * other); an explicit -o path intentionally overwrites. If the destination is
 * unwritable the buffer is salvaged to the OS temp dir — the generation was
 * already paid for and must never be discarded.
 */
export async function saveImage(buffer: Buffer, opts: SaveOptions): Promise<string> {
  const dir = process.cwd();
  const ext = extensionForMime(opts.mimeType);

  try {
    if (opts.outputPath) {
      const filePath = path.resolve(dir, opts.outputPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await writeAtomic(filePath, buffer, false);
      return filePath;
    }
    // Auto-name with exclusive claim, retrying on concurrent collisions.
    for (let attempt = 0; attempt < 50; attempt++) {
      const filePath = path.resolve(dir, await autoName(opts.prompt, dir, ext));
      try {
        await writeAtomic(filePath, buffer, true);
        return filePath;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw err;
      }
    }
    throw new Error('could not claim a free filename after 50 attempts');
  } catch (err) {
    const salvage = path.join(
      os.tmpdir(),
      `nanaban-salvage-${slugFromPrompt(opts.prompt).slice(0, 40)}-${Date.now()}${ext}`,
    );
    try {
      await fs.writeFile(salvage, buffer);
    } catch {
      throw new NB2Error(
        'OUTPUT_UNWRITABLE',
        `Could not write the image (${(err as Error).message}) and salvage to ${salvage} also failed. ` +
          'The generated image was lost — fix the output location before retrying (the generation itself succeeded).',
      );
    }
    throw new NB2Error(
      'OUTPUT_UNWRITABLE',
      `Could not write the image to the requested location (${(err as Error).message}). ` +
        `The generated image was saved to ${salvage} instead — move it from there; do NOT re-run the generation.`,
    );
  }
}
