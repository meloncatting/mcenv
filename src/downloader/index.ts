/**
 * Downloader: fetches artifacts, verifies integrity, populates cache.
 *
 * - Downloads are streamed directly to the cache directory.
 * - SHA-256 is computed on-the-fly during streaming (no double read).
 * - Parallel downloads with a concurrency limit to avoid hammering CDNs.
 */

import { createWriteStream, copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import { ResolvedArtifact } from '../resolver/index.js';
import { LockedArtifact } from '../lockfile/schema.js';
import { cachedPath, isCached, sha256OfFile, sha1OfFile } from './cache.js';
import { createHash } from 'crypto';

const CONCURRENCY = 4;

export interface DownloadResult {
  artifact: LockedArtifact;
  fromCache: boolean;
}

export async function downloadAll(
  artifacts: ResolvedArtifact[],
  serverDir: string,
  onProgress?: (name: string, done: number, total: number) => void,
): Promise<LockedArtifact[]> {
  const results: LockedArtifact[] = [];
  const queue = [...artifacts];
  let done = 0;

  // Process in batches of CONCURRENCY
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((a) =>
        downloadOne(a, serverDir).then((r) => {
          done++;
          onProgress?.(a.name, done, artifacts.length);
          return r;
        })
      )
    );
    results.push(...batchResults);
  }

  return results;
}

async function downloadOne(artifact: ResolvedArtifact, serverDir: string): Promise<LockedArtifact> {
  const { url, name, dest } = artifact;

  // Skip local files
  if (url.startsWith('file://')) {
    const localPath = url.slice(7);
    const destPath = join(serverDir, dest);
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(localPath, destPath);
    const sha256 = await sha256OfFile(destPath);
    return { ...artifact, sha256, dest };
  }

  const cachePath = cachedPath(url);
  let sha256: string;

  if (isCached(url)) {
    sha256 = await sha256OfFile(cachePath);
    // Verify against known hash if we have one
    if (artifact.sha256 && sha256 !== artifact.sha256) {
      throw new Error(
        `Cache corruption for ${name}: expected ${artifact.sha256} got ${sha256}. ` +
        `Delete ${cachePath} and retry.`
      );
    }
  } else {
    sha256 = await streamDownload(url, cachePath, artifact.sha256, artifact.sha1);
  }

  // Copy from cache to server directory
  const destPath = join(serverDir, dest);
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(cachePath, destPath);

  return {
    name,
    version: artifact.version,
    url,
    sha256,
    dest,
    resolved_at: artifact.resolved_at,
  };
}

/**
 * Stream-download url to destPath, computing SHA-256 on the fly.
 * Optionally verifies against expectedSha256 or expectedSha1.
 */
async function streamDownload(
  url: string,
  destPath: string,
  expectedSha256?: string,
  expectedSha1?: string,
): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed for ${url}: HTTP ${res.status}`);
  if (!res.body) throw new Error(`No response body for ${url}`);

  const sha256 = createHash('sha256');
  const sha1 = createHash('sha1');
  const writer = createWriteStream(destPath);

  await new Promise<void>((resolve, reject) => {
    res.body!.on('data', (chunk: Buffer) => {
      sha256.update(chunk);
      sha1.update(chunk);
      writer.write(chunk);
    });
    res.body!.on('end', () => writer.end(resolve));
    res.body!.on('error', reject);
    writer.on('error', reject);
  });

  const computedSha256 = sha256.digest('hex');
  const computedSha1 = sha1.digest('hex');

  if (expectedSha256 && computedSha256 !== expectedSha256) {
    throw new Error(
      `Integrity check failed for ${url}:\n` +
      `  expected SHA-256: ${expectedSha256}\n` +
      `  computed SHA-256: ${computedSha256}`
    );
  }
  if (expectedSha1 && computedSha1 !== expectedSha1) {
    throw new Error(
      `Integrity check failed for ${url}:\n` +
      `  expected SHA-1: ${expectedSha1}\n` +
      `  computed SHA-1: ${computedSha1}`
    );
  }

  return computedSha256;
}
