import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { env } from '../config/env';

/**
 * Local-disk adapter. Swap for S3/GCS in production behind the same interface.
 * Files live OUTSIDE any web root and are only ever read by the ingestion worker.
 * Storage keys are server-generated UUIDs — never derived from user input.
 */
@Injectable()
export class MaterialStorageService {
  private readonly root = resolve(env.UPLOAD_DIR);

  async storeMaterialFile(content: Buffer, extension: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const storageKey = `${randomUUID()}.${extension}`;
    await writeFile(this.resolveKey(storageKey), content, { mode: 0o600, flag: 'wx' });
    return storageKey;
  }

  readMaterialFile(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storageKey));
  }

  async deleteMaterialFile(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }

  private resolveKey(storageKey: string): string {
    if (!/^[0-9a-f-]{36}\.[a-z]{3,4}$/.test(storageKey)) throw new Error('Invalid storage key');
    const fullPath = resolve(join(this.root, storageKey));
    if (!fullPath.startsWith(this.root + sep)) throw new Error('Path traversal blocked');
    return fullPath;
  }
}
