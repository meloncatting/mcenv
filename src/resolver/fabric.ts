import fetch from 'node-fetch';
import semver from 'semver';

const META_BASE = 'https://meta.fabricmc.net/v2';
const INSTALLER_BASE = 'https://meta.fabricmc.net/v2/versions/installer';

interface FabricLoaderVersion { version: string; stable: boolean }
interface FabricInstallerVersion { version: string; stable: boolean; url: string; maven: string }

export async function resolveLatestFabricLoader(constraint?: string): Promise<string> {
  const res = await fetch(`${META_BASE}/versions/loader`);
  if (!res.ok) throw new Error(`Fabric meta API failed: ${res.status}`);
  const loaders = await res.json() as FabricLoaderVersion[];

  const stableLoaders = loaders.filter((l) => l.stable);
  if (!constraint || constraint === '*' || constraint === 'latest') {
    return stableLoaders[0]!.version;
  }

  for (const l of stableLoaders) {
    const clean = semver.coerce(l.version);
    if (clean && semver.satisfies(clean.version, constraint)) return l.version;
  }

  // Exact match fallback
  const exact = loaders.find((l) => l.version === constraint);
  if (exact) return exact.version;

  throw new Error(`No Fabric loader satisfies constraint "${constraint}"`);
}

export async function resolveLatestFabricInstaller(): Promise<FabricInstallerVersion> {
  const res = await fetch(INSTALLER_BASE);
  if (!res.ok) throw new Error(`Fabric installer API failed: ${res.status}`);
  const installers = await res.json() as FabricInstallerVersion[];
  const stable = installers.find((i) => i.stable);
  return stable ?? installers[0]!;
}

/**
 * Returns the URL for the Fabric server launcher jar.
 * The launcher jar bootstraps the actual loader at runtime, so no install step needed.
 */
export function fabricServerLauncherUrl(mcVersion: string, loaderVersion: string, installerVersion: string): string {
  return `${META_BASE}/versions/loader/${mcVersion}/${loaderVersion}/${installerVersion}/server/jar`;
}
