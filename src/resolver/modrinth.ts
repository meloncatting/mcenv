import fetch from 'node-fetch';
import semver from 'semver';

const BASE = 'https://api.modrinth.com/v2';
const UA = 'mcenv/1.0.0 (github.com/mcenv)';

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  loaders: string[];
  game_versions: string[];
  files: Array<{ url: string; filename: string; hashes: { sha512: string; sha1: string }; primary: boolean }>;
  dependencies: Array<{ project_id: string | null; version_id: string | null; dependency_type: 'required' | 'optional' | 'incompatible' }>;
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  project_type: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Modrinth API ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function getProject(idOrSlug: string): Promise<ModrinthProject> {
  return get<ModrinthProject>(`/project/${idOrSlug}`);
}

export async function getProjectVersions(
  idOrSlug: string,
  loaders: string[],
  gameVersions: string[],
): Promise<ModrinthVersion[]> {
  const params = new URLSearchParams();
  params.set('loaders', JSON.stringify(loaders));
  params.set('game_versions', JSON.stringify(gameVersions));
  return get<ModrinthVersion[]>(`/project/${idOrSlug}/version?${params}`);
}

/**
 * Resolve a Modrinth project to a single version satisfying the constraint.
 * Strategy: pick the newest version whose version_number satisfies the semver
 * range. Falls back to latest-compatible if the version_number isn't valid semver.
 */
export async function resolveModrinthMod(
  idOrSlug: string,
  versionConstraint: string,
  loader: string,
  mcVersion: string,
): Promise<ModrinthVersion> {
  const loaderVariants = buildLoaderVariants(loader);
  const versions = await getProjectVersions(idOrSlug, loaderVariants, [mcVersion]);

  if (versions.length === 0) {
    throw new Error(
      `No versions of "${idOrSlug}" found for MC ${mcVersion} with loader ${loader}. ` +
      `Check the project page on modrinth.com for supported versions.`
    );
  }

  // Sort newest first (Modrinth already returns newest first, but be explicit)
  const sorted = [...versions].sort((a, b) =>
    compareVersionNumbers(b.version_number, a.version_number)
  );

  if (versionConstraint === '*' || versionConstraint === 'latest') {
    return sorted[0]!;
  }

  // Try semver matching
  for (const v of sorted) {
    const clean = semver.coerce(v.version_number);
    if (clean && semver.satisfies(clean.version, versionConstraint)) {
      return v;
    }
  }

  // Fallback: exact string match
  const exact = sorted.find((v) => v.version_number === versionConstraint || v.id === versionConstraint);
  if (exact) return exact;

  throw new Error(
    `No version of "${idOrSlug}" satisfies constraint "${versionConstraint}" ` +
    `for MC ${mcVersion}/${loader}. Available: ${sorted.slice(0, 5).map((v) => v.version_number).join(', ')}`
  );
}

/** Map loader type to what Modrinth uses in its API */
function buildLoaderVariants(loader: string): string[] {
  const map: Record<string, string[]> = {
    fabric: ['fabric'],
    quilt: ['quilt', 'fabric'],  // Quilt can run Fabric mods
    forge: ['forge'],
    neoforge: ['neoforge', 'forge'],
    paper: ['paper', 'bukkit', 'spigot'],
    vanilla: ['vanilla'],
  };
  return map[loader] ?? [loader];
}

function compareVersionNumbers(a: string, b: string): number {
  const ca = semver.coerce(a);
  const cb = semver.coerce(b);
  if (ca && cb) return semver.compare(ca.version, cb.version);
  return a.localeCompare(b);
}

export function primaryFile(version: ModrinthVersion) {
  return version.files.find((f) => f.primary) ?? version.files[0];
}

/**
 * Identify a batch of jar files by their SHA-512 hashes.
 * Returns a map of sha512 → ModrinthVersion for every hash that matched.
 * Unrecognised hashes (e.g. private mods) are simply absent from the result.
 */
export async function fingerprintJars(sha512Hashes: string[]): Promise<Map<string, ModrinthVersion & { slug: string }>> {
  if (sha512Hashes.length === 0) return new Map();

  const res = await fetch(`${BASE}/version_files`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: sha512Hashes, algorithm: 'sha512' }),
  });
  if (!res.ok) throw new Error(`Modrinth fingerprint API failed: ${res.status}`);

  const data = await res.json() as Record<string, ModrinthVersion>;

  // Enrich with slug from a batch project lookup
  const projectIds = [...new Set(Object.values(data).map((v) => v.project_id))];
  const slugMap = await batchGetSlugs(projectIds);

  const result = new Map<string, ModrinthVersion & { slug: string }>();
  for (const [hash, version] of Object.entries(data)) {
    result.set(hash, { ...version, slug: slugMap.get(version.project_id) ?? version.project_id });
  }
  return result;
}

async function batchGetSlugs(projectIds: string[]): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const params = new URLSearchParams({ ids: JSON.stringify(projectIds) });
  const res = await fetch(`${BASE}/projects?${params}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return new Map();
  const projects = await res.json() as Array<{ id: string; slug: string }>;
  return new Map(projects.map((p) => [p.id, p.slug]));
}
