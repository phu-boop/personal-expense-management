import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import StorageAdapter, { StoragePutResult } from './StorageAdapter';
import config from '../../config';

const EXPORT_DIR = path.resolve(process.cwd(), config.EXPORT_DIR || 'exports');

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export default class LocalFilesystemStorage implements StorageAdapter {
  baseDir: string;
  constructor(baseDir = EXPORT_DIR) {
    this.baseDir = baseDir;
    try {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o777 });
      try {
        fs.chmodSync(this.baseDir, 0o777);
      } catch (err) {
        // ignore chmod failures on platforms that don't support it
      }
    } catch (err: any) {
      // If creating the configured absolute path fails (e.g., running locally without
      // permissions to create `/app/exports`), fall back to a project-local exports
      // directory so the worker can still write files during local development.
      try {
        const fallback = path.resolve(process.cwd(), 'exports');
        fs.mkdirSync(fallback, { recursive: true, mode: 0o777 });
        try { fs.chmodSync(fallback, 0o777); } catch (e) {}
        this.baseDir = fallback;
      } catch (err2) {
        // Last resort: leave baseDir as-is; writes will fail and surface errors.
      }
    }
  }

  async put(nameHint: string, data: NodeJS.ReadableStream | Buffer): Promise<StoragePutResult> {
    const safe = safeName(path.basename(nameHint || 'export'));
    const random = crypto.randomBytes(8).toString('hex');
    const fileName = `${Date.now()}-${random}-${safe}`;
    const filePath = path.join(this.baseDir, fileName);

    if (Buffer.isBuffer(data)) {
      try {
        await fs.promises.writeFile(filePath, data, { mode: 0o666 });
        return { fileKey: filePath };
      } catch (err: any) {
        // Fallback to a project-local exports dir if writing to configured
        // baseDir fails due to permissions or missing mounts.
        const fallback = path.resolve(process.cwd(), 'exports');
        try {
          fs.mkdirSync(fallback, { recursive: true, mode: 0o777 });
          const fallbackPath = path.join(fallback, fileName);
          await fs.promises.writeFile(fallbackPath, data, { mode: 0o666 });
          return { fileKey: fallbackPath };
        } catch (err2) {
          throw err;
        }
      }
    }

    // stream
    try {
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(filePath, { flags: 'w', mode: 0o666 });
        data.pipe(out);
        out.on('finish', () => resolve());
        out.on('error', (err) => reject(err));
        (data as NodeJS.ReadableStream).on('error', (err) => reject(err));
      });

      return { fileKey: filePath };
    } catch (err: any) {
      // Fallback to project-local exports directory
      const fallback = path.resolve(process.cwd(), 'exports');
      try {
        fs.mkdirSync(fallback, { recursive: true, mode: 0o777 });
        const fallbackPath = path.join(fallback, fileName);
        await new Promise<void>((resolve, reject) => {
          const out = fs.createWriteStream(fallbackPath, { flags: 'w', mode: 0o666 });
          data.pipe(out);
          out.on('finish', () => resolve());
          out.on('error', (err) => reject(err));
          (data as NodeJS.ReadableStream).on('error', (err) => reject(err));
        });

        return { fileKey: fallbackPath };
      } catch (err2) {
        throw err;
      }
    }
  }
}
