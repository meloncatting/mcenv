import { createHash } from 'crypto';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR = join(homedir(), '.mcenv', 'cache');

export function getCacheDir(): string {
  mkdirSync(CACHE_DIR, { recursive: true });
  return CACHE_DIR;
}

/** Cache key = SHA-256 of the URL (avoids filesystem-unsafe characters) */
export function cacheKeyForUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export function cachedPath(url: string): string {
  return join(getCacheDir(), cacheKeyForUrl(url));
}

export function isCached(url: string): boolean {
  return existsSync(cachedPath(url));
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk as Buffer))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

export async function sha1OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk as Buffer))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}
