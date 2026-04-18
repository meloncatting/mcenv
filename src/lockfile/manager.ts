import { existsSync, readFileSync, writeFileSync } from 'fs';
import { McEnvLockfile } from './schema.js';

const LOCKFILE_NAME = 'mcenv.lock.json';
const MCENV_VERSION = '1.0.0';

export function readLockfile(dir: string): McEnvLockfile | null {
  const p = `${dir}/${LOCKFILE_NAME}`;
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as McEnvLockfile;
}

export function writeLockfile(dir: string, lock: McEnvLockfile): void {
  const p = `${dir}/${LOCKFILE_NAME}`;
  writeFileSync(p, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

export function createLockfile(name: string, mcVersion: string): McEnvLockfile {
  return {
    name,
    minecraft_version: mcVersion,
    mcenv_version: MCENV_VERSION,
    generated_at: new Date().toISOString(),
    artifacts: {},
  };
}

/** Returns artifact keys present in the lockfile but absent in the new plan */
export function findRemovedArtifacts(
  old: McEnvLockfile | null,
  newKeys: Set<string>,
): string[] {
  if (!old) return [];
  return Object.keys(old.artifacts).filter((k) => !newKeys.has(k));
}
