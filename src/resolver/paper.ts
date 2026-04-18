import fetch from 'node-fetch';

const BASE = 'https://api.papermc.io/v2';

interface PaperBuilds { builds: number[] }
interface PaperBuildInfo {
  build: number;
  downloads: { application: { name: string; sha256: string } };
}

export async function resolveLatestPaperBuild(mcVersion: string): Promise<{ url: string; sha256: string; build: number }> {
  const buildsRes = await fetch(`${BASE}/projects/paper/versions/${mcVersion}/builds`);
  if (!buildsRes.ok) {
    if (buildsRes.status === 404)
      throw new Error(`Paper does not support Minecraft ${mcVersion}. Check papermc.io for supported versions.`);
    throw new Error(`Paper API failed: ${buildsRes.status}`);
  }
  const { builds } = await buildsRes.json() as PaperBuilds;
  if (builds.length === 0) throw new Error(`No Paper builds for MC ${mcVersion}`);

  const latestBuild = builds[builds.length - 1]!;
  const buildRes = await fetch(`${BASE}/projects/paper/versions/${mcVersion}/builds/${latestBuild}`);
  if (!buildRes.ok) throw new Error(`Paper build info fetch failed: ${buildRes.status}`);
  const info = await buildRes.json() as PaperBuildInfo;

  const filename = info.downloads.application.name;
  const url = `${BASE}/projects/paper/versions/${mcVersion}/builds/${latestBuild}/downloads/${filename}`;
  return { url, sha256: info.downloads.application.sha256, build: latestBuild };
}
