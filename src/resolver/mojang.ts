import fetch from 'node-fetch';

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

interface VersionEntry { id: string; type: string; url: string; }
interface VersionManifest { versions: VersionEntry[]; }
interface VersionMeta { downloads: { server?: { url: string; sha1: string; size: number } } }

let manifestCache: VersionManifest | null = null;

async function getManifest(): Promise<VersionManifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Mojang manifest fetch failed: ${res.status}`);
  manifestCache = await res.json() as VersionManifest;
  return manifestCache;
}

export async function resolveVanillaServer(mcVersion: string): Promise<{ url: string; sha1: string }> {
  const manifest = await getManifest();
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`Unknown Minecraft version: ${mcVersion}`);

  const metaRes = await fetch(entry.url);
  if (!metaRes.ok) throw new Error(`Failed to fetch version meta for ${mcVersion}`);
  const meta = await metaRes.json() as VersionMeta;

  const server = meta.downloads.server;
  if (!server) throw new Error(`No server download available for Minecraft ${mcVersion}`);
  return { url: server.url, sha1: server.sha1 };
}

export async function listReleaseVersions(): Promise<string[]> {
  const manifest = await getManifest();
  return manifest.versions.filter((v) => v.type === 'release').map((v) => v.id);
}
