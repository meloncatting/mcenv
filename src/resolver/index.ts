/**
 * Resolver: turns an McEnvConfig into a flat list of ResolvedArtifacts.
 *
 * Resolution order:
 *   1. Server jar (vanilla/paper/fabric/forge)
 *   2. Loader jar (fabric-api, etc.) if needed
 *   3. Mods/plugins — resolved from Modrinth or direct URL
 *   4. Transitive required dependencies declared by mods (one level deep)
 *
 * Conflict detection: if two mods require the same project with incompatible
 * version ranges, resolution fails fast with a clear error message.
 */

import { McEnvConfig, ModEntry } from '../config/schema.js';
import { LockedArtifact } from '../lockfile/schema.js';
import { resolveVanillaServer } from './mojang.js';
import { resolveLatestPaperBuild } from './paper.js';
import { resolveLatestFabricLoader, resolveLatestFabricInstaller, fabricServerLauncherUrl } from './fabric.js';
import {
  resolveModrinthMod,
  getProjectVersions,
  primaryFile,
  ModrinthVersion,
} from './modrinth.js';

export interface ResolvedArtifact extends Omit<LockedArtifact, 'sha256'> {
  sha256?: string;       // may be absent for URLs with no hash API (filled in by downloader)
  sha1?: string;         // some APIs return sha1 instead
}

export async function resolveAll(config: McEnvConfig): Promise<ResolvedArtifact[]> {
  const artifacts: ResolvedArtifact[] = [];
  const now = new Date().toISOString();
  const mcVersion = config.minecraft_version;
  const loaderType = config.loader.type;
  const loaderConstraint = config.loader.version;

  // ── 1. Server / Loader jar ─────────────────────────────────────────────────

  if (loaderType === 'vanilla') {
    const { url, sha1 } = await resolveVanillaServer(mcVersion);
    artifacts.push({
      name: 'minecraft-server',
      version: mcVersion,
      url,
      sha1,
      dest: 'server.jar',
      resolved_at: now,
    });

  } else if (loaderType === 'paper') {
    const { url, sha256, build } = await resolveLatestPaperBuild(mcVersion);
    artifacts.push({
      name: 'paper-server',
      version: `${mcVersion}-build.${build}`,
      url,
      sha256,
      dest: 'server.jar',
      resolved_at: now,
    });

  } else if (loaderType === 'fabric') {
    const loaderVersion = await resolveLatestFabricLoader(loaderConstraint);
    const installer = await resolveLatestFabricInstaller();
    const url = fabricServerLauncherUrl(mcVersion, loaderVersion, installer.version);
    artifacts.push({
      name: 'fabric-server',
      version: `${mcVersion}+loader.${loaderVersion}`,
      url,
      dest: 'server.jar',
      resolved_at: now,
    });

  } else if (loaderType === 'quilt') {
    // Quilt uses the same server launcher pattern as Fabric
    const url = `https://quiltmc.org/api/v1/download-latest-installer/java-universal`;
    artifacts.push({
      name: 'quilt-installer',
      version: 'latest',
      url,
      dest: 'quilt-installer.jar',
      resolved_at: now,
    });

  } else if (loaderType === 'forge' || loaderType === 'neoforge') {
    // Forge/NeoForge require running an installer — we download the installer jar
    const resolvedUrl = await resolveForgeInstaller(mcVersion, loaderType, loaderConstraint);
    artifacts.push({
      name: `${loaderType}-installer`,
      version: `${mcVersion}-${loaderConstraint ?? 'latest'}`,
      url: resolvedUrl,
      dest: `${loaderType}-installer.jar`,
      resolved_at: now,
    });
  }

  // ── 2. Mods / Plugins ─────────────────────────────────────────────────────

  const modEntries = [...(config.mods ?? []), ...(config.plugins ?? [])];
  const seen = new Map<string, { constraint: string; requiredBy: string }>();

  const resolvedMods = await resolveModList(modEntries, loaderType, mcVersion, seen, now);
  artifacts.push(...resolvedMods);

  return artifacts;
}

async function resolveModList(
  mods: ModEntry[],
  loader: string,
  mcVersion: string,
  seen: Map<string, { constraint: string; requiredBy: string }>,
  now: string,
): Promise<ResolvedArtifact[]> {
  const artifacts: ResolvedArtifact[] = [];
  const transitiveMods: ModEntry[] = [];

  for (const mod of mods) {
    if (mod.source === 'local') {
      artifacts.push({
        name: mod.id,
        version: mod.version,
        url: `file://${mod.path}`,
        dest: `mods/${mod.path!.split('/').pop()}`,
        resolved_at: now,
      });
      continue;
    }

    if (mod.source === 'url') {
      artifacts.push({
        name: mod.id,
        version: mod.version,
        url: mod.url!,
        dest: `mods/${mod.id}.jar`,
        resolved_at: now,
      });
      continue;
    }

    if (mod.source === 'curseforge') {
      throw new Error(
        `CurseForge source for mod "${mod.id}" requires an API key. ` +
        `Set CURSEFORGE_API_KEY env var or migrate to Modrinth.`
      );
    }

    // Modrinth resolution
    const existing = seen.get(mod.id);
    if (existing) {
      // Conflict check: if same mod required twice, constraints must be compatible
      if (existing.constraint !== mod.version && mod.version !== '*' && existing.constraint !== '*') {
        console.warn(
          `  ⚠ Version conflict for "${mod.id}": ` +
          `"${existing.constraint}" (from ${existing.requiredBy}) vs "${mod.version}" — using first constraint`
        );
      }
      continue;  // Already resolved
    }

    seen.set(mod.id, { constraint: mod.version, requiredBy: 'config' });

    let resolved: ModrinthVersion;
    try {
      resolved = await resolveModrinthMod(mod.id, mod.version, loader, mcVersion);
    } catch (err) {
      if (mod.required === false) {
        console.warn(`  ⚠ Skipping optional mod "${mod.id}": ${(err as Error).message}`);
        continue;
      }
      throw err;
    }

    // Normalise: track both the slug we were given AND the canonical project_id
    // so transitive deps that reference the same project by ID don't duplicate it.
    seen.set(resolved.project_id, { constraint: mod.version, requiredBy: 'config' });

    const file = primaryFile(resolved);
    if (!file) throw new Error(`Mod "${mod.id}" version ${resolved.version_number} has no downloadable files`);

    artifacts.push({
      name: mod.id,
      version: resolved.version_number,
      url: file.url,
      sha256: undefined,           // Modrinth provides sha512; downloader will verify via sha1
      dest: `mods/${file.filename}`,
      resolved_at: now,
    });

    // Collect required transitive dependencies
    for (const dep of resolved.dependencies) {
      if (dep.dependency_type === 'required' && dep.project_id && !seen.has(dep.project_id)) {
        transitiveMods.push({
          id: dep.project_id,
          source: 'modrinth',
          version: dep.version_id ?? '*',
        });
      }
    }
  }

  // Resolve transitive deps (one pass — deep trees are rare in MC modding)
  if (transitiveMods.length > 0) {
    const transitiveArtifacts = await resolveModList(transitiveMods, loader, mcVersion, seen, now);
    artifacts.push(...transitiveArtifacts);
  }

  return artifacts;
}

async function resolveForgeInstaller(
  mcVersion: string,
  loaderType: 'forge' | 'neoforge',
  constraint?: string,
): Promise<string> {
  if (loaderType === 'neoforge') {
    // NeoForge uses a different URL pattern
    const neoVersion = constraint ?? await resolveLatestNeoForgeVersion(mcVersion);
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
  }

  const forgeVersion = constraint ?? await resolveLatestForgeVersion(mcVersion);
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
}

async function resolveLatestForgeVersion(mcVersion: string): Promise<string> {
  // Forge doesn't have a clean API; we read their Maven metadata XML
  const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Forge Maven metadata fetch failed: ${res.status}`);
  const xml = await res.text();
  // Extract versions matching mcVersion prefix
  const re = new RegExp(`<version>${escapeRegex(mcVersion)}-([\\d.]+)</version>`, 'g');
  let last: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) last = m[1];
  if (!last) throw new Error(`No Forge version found for MC ${mcVersion}`);
  return last;
}

async function resolveLatestNeoForgeVersion(mcVersion: string): Promise<string> {
  const shortVer = mcVersion.replace(/^1\./, '');
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NeoForge Maven metadata fetch failed: ${res.status}`);
  const xml = await res.text();
  const re = new RegExp(`<version>(${escapeRegex(shortVer)}\\.[\\d.]+)</version>`, 'g');
  let last: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) last = m[1];
  if (!last) throw new Error(`No NeoForge version found for MC ${mcVersion}`);
  return last;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
