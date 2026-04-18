#!/usr/bin/env node
/**
 * mcenv — Reproducible Minecraft server environments
 *
 *   mcenv init   <server-dir>   Scan an existing server → generate mcenv.yaml + configs/
 *   mcenv install               Download + install everything defined in mcenv.yaml
 *   mcenv update                Re-resolve versions (ignores lockfile) then install
 *   mcenv list                  Show what's locked / installed
 *   mcenv validate              Check the config for errors without touching the network
 *   mcenv clean                 Delete the server directory (keeps download cache)
 *   mcenv cache                 Manage the local download cache
 *   mcenv dockerize             Generate Dockerfile + docker-compose.yml
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, dirname, join } from 'path';
import { existsSync, rmSync, readdirSync, statSync } from 'fs';

import { loadConfig } from './config/loader.js';
import { validateCompatibility } from './validator/index.js';
import { readLockfile, writeLockfile, createLockfile, findRemovedArtifacts } from './lockfile/manager.js';
import { resolveAll } from './resolver/index.js';
import { downloadAll } from './downloader/index.js';
import { setupServerDirectory } from './installer/index.js';
import { generateDockerfile } from './docker/generator.js';
import { initFromServer } from './init/index.js';
import { getCacheDir } from './downloader/cache.js';

const program = new Command();

program
  .name('mcenv')
  .description('Reproducible Minecraft server environments — define once, reproduce anywhere')
  .version('1.0.0');

// ── mcenv init ────────────────────────────────────────────────────────────────

program
  .command('init [server-dir]')
  .description(
    'Scan an existing server directory and generate mcenv.yaml + a configs/ folder.\n' +
    'If no server-dir is given, creates a blank starter config instead.'
  )
  .option('-n, --name <name>', 'Environment name (defaults to directory name)')
  .option('-o, --output <dir>', 'Where to write mcenv.yaml and configs/', '.')
  .option('--dry-run', 'Print what would be generated without writing any files')
  .action(async (serverDir: string | undefined, opts: { name?: string; output: string; dryRun: boolean }) => {
    try {
      await cmdInit(serverDir, opts);
    } catch (err) { fatal(err); }
  });

// ── mcenv install ─────────────────────────────────────────────────────────────

program
  .command('install')
  .alias('up')
  .description(
    'Download and install all mods, plugins, and configs defined in mcenv.yaml.\n' +
    'Uses the lockfile if present (same versions every time).\n' +
    'Run `mcenv update` to pick up newer versions.'
  )
  .option('-f, --file <path>', 'Path to mcenv.yaml', 'mcenv.yaml')
  .option('-o, --output <dir>', 'Server output directory', 'server')
  .option('--ci', 'Fail if lockfile would change (safe for CI/CD pipelines)')
  .option('--offline', 'Skip network — use only what\'s already in the local cache')
  .option('--docker', 'Also generate a Dockerfile and docker-compose.yml')
  .action(async (opts: { file: string; output: string; ci: boolean; offline: boolean; docker: boolean }) => {
    try {
      await cmdInstall(opts, false);
    } catch (err) { fatal(err); }
  });

// ── mcenv update ──────────────────────────────────────────────────────────────

program
  .command('update')
  .description(
    'Re-resolve all version constraints from scratch and reinstall.\n' +
    'Use this to pull in newer mod versions when your config uses "*" or ranges.\n' +
    'Rewrites mcenv.lock.json with the new pinned versions.'
  )
  .option('-f, --file <path>', 'Path to mcenv.yaml', 'mcenv.yaml')
  .option('-o, --output <dir>', 'Server output directory', 'server')
  .action(async (opts: { file: string; output: string }) => {
    try {
      await cmdInstall({ ...opts, ci: false, offline: false, docker: false }, true);
    } catch (err) { fatal(err); }
  });

// ── mcenv list ────────────────────────────────────────────────────────────────

program
  .command('list')
  .alias('status')
  .description('Show every artifact pinned in the lockfile — name, version, SHA-256.')
  .option('-f, --file <path>', 'Directory containing mcenv.lock.json', '.')
  .action((opts: { file: string }) => {
    const lock = readLockfile(opts.file);
    if (!lock) {
      bail('No lockfile found. Run `mcenv install` first.');
    }

    const col1 = 32, col2 = 36;
    console.log(chalk.bold(`\n  ${lock.name}`) + chalk.gray(` — MC ${lock.minecraft_version} — mcenv v${lock.mcenv_version}`));
    console.log(chalk.gray(`  Locked at ${lock.generated_at}\n`));
    console.log(
      chalk.gray('  ' + 'ARTIFACT'.padEnd(col1) + 'VERSION'.padEnd(col2) + 'SHA-256')
    );
    console.log(chalk.gray('  ' + '─'.repeat(col1 + col2 + 14)));

    for (const [, a] of Object.entries(lock.artifacts)) {
      const hash = a.sha256.startsWith('UNVERIFIED') ? chalk.yellow('unverified') : chalk.gray(a.sha256.slice(0, 12) + '…');
      console.log(`  ${chalk.cyan(a.name.padEnd(col1))}${chalk.white(a.version.padEnd(col2))}${hash}`);
    }
    console.log();
  });

// ── mcenv validate ────────────────────────────────────────────────────────────

program
  .command('validate')
  .description('Check mcenv.yaml for errors and compatibility issues. No network required.')
  .option('-f, --file <path>', 'Path to mcenv.yaml', 'mcenv.yaml')
  .action((opts: { file: string }) => {
    try {
      const config = loadConfig(resolve(opts.file));
      const warnings = validateCompatibility(config);
      const errors = warnings.filter((w) => w.level === 'error');
      const warns = warnings.filter((w) => w.level === 'warn');

      if (errors.length === 0 && warns.length === 0) {
        console.log(chalk.green(`\n  ✓ ${config.name} — config looks good\n`));
        return;
      }

      console.log(chalk.bold(`\n  ${config.name} — MC ${config.minecraft_version} / ${config.loader.type}\n`));
      for (const w of warns) console.log(chalk.yellow(`  ⚠  ${w.message}`));
      for (const e of errors) console.log(chalk.red(`  ✗  ${e.message}`));
      console.log();

      if (errors.length > 0) process.exit(1);
    } catch (err) { fatal(err); }
  });

// ── mcenv clean ───────────────────────────────────────────────────────────────

program
  .command('clean')
  .description('Delete the server directory. The download cache (~/.mcenv/cache/) is kept.')
  .option('-o, --output <dir>', 'Server directory to remove', 'server')
  .action((opts: { output: string }) => {
    const dir = resolve(opts.output);
    if (!existsSync(dir)) {
      console.log(chalk.yellow(`  Server directory not found: ${dir}`));
      return;
    }
    rmSync(dir, { recursive: true, force: true });
    console.log(chalk.green(`  ✓ Removed ${dir}`));
  });

// ── mcenv cache ───────────────────────────────────────────────────────────────

const cacheCmd = program.command('cache').description('Manage the local download cache (~/.mcenv/cache/)');

cacheCmd
  .command('clean')
  .description('Delete all cached downloads (forces a fresh download next install)')
  .action(() => {
    const dir = getCacheDir();
    rmSync(dir, { recursive: true, force: true });
    console.log(chalk.green(`  ✓ Cache cleared: ${dir}`));
  });

cacheCmd
  .command('size')
  .description('Show how much disk space the cache is using')
  .action(() => {
    const dir = getCacheDir();
    if (!existsSync(dir)) { console.log('  Cache is empty.'); return; }
    const bytes = dirSize(dir);
    console.log(`  Cache: ${dir}`);
    console.log(`  Size:  ${formatBytes(bytes)}`);
  });

cacheCmd
  .command('path')
  .description('Print the cache directory path')
  .action(() => console.log(getCacheDir()));

// ── mcenv dockerize ───────────────────────────────────────────────────────────

program
  .command('dockerize')
  .alias('docker')
  .description('Generate a Dockerfile and docker-compose.yml for the installed server directory.')
  .option('-f, --file <path>', 'Path to mcenv.yaml', 'mcenv.yaml')
  .option('-o, --output <dir>', 'Server directory', 'server')
  .action(async (opts: { file: string; output: string }) => {
    try {
      const config = loadConfig(resolve(opts.file));
      const serverDir = resolve(opts.output);
      if (!existsSync(serverDir)) bail(`Server directory not found: ${serverDir}\nRun \`mcenv install\` first.`);
      generateDockerfile(serverDir, config);
      console.log(chalk.green(`\n  ✓ Dockerfile + docker-compose.yml written to ${serverDir}`));
      console.log(chalk.gray(`  Build:  docker build -t mcenv-${config.name} ${serverDir}`));
      console.log(chalk.gray(`  Launch: docker compose -f ${serverDir}/docker-compose.yml up\n`));
    } catch (err) { fatal(err); }
  });

program.parse();

// ── Command implementations ───────────────────────────────────────────────────

async function cmdInit(
  serverDir: string | undefined,
  opts: { name?: string; output: string; dryRun: boolean },
) {
  const outputDir = resolve(opts.output);

  if (!serverDir) {
    // No server to scan — write a starter blank config
    const name = opts.name ?? 'my-server';
    const starterYaml = blankStarterConfig(name);
    if (!opts.dryRun) {
      const { writeFileSync, mkdirSync } = await import('fs');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'mcenv.yaml'), starterYaml);
      mkdirSync(join(outputDir, 'configs'), { recursive: true });
    }
    console.log(chalk.green(`\n  ✓ Created mcenv.yaml and configs/`));
    console.log(chalk.gray(`  Edit mcenv.yaml, then run: mcenv install\n`));
    return;
  }

  const absServerDir = resolve(serverDir);
  const name = opts.name ?? absServerDir.split('/').pop() ?? 'my-server';

  console.log(chalk.bold(`\n  mcenv init — scanning ${absServerDir}\n`));

  const result = await initFromServer({
    serverDir: absServerDir,
    outputDir,
    name,
    dryRun: opts.dryRun,
  });

  const tag = opts.dryRun ? chalk.yellow('[dry-run] ') : '';

  console.log(chalk.green(`\n  ✓ ${tag}mcenv.yaml written`));
  console.log(chalk.green(`  ✓ ${tag}configs/ populated (${result.configFilesCopied} files)`));

  if (result.unknownJars.length > 0) {
    console.log(chalk.yellow(`\n  ⚠  ${result.unknownJars.length} jar(s) not found on Modrinth — added as local:`));
    for (const j of result.unknownJars) console.log(chalk.gray(`     ${j}`));
  }

  console.log(chalk.gray(`\n  MC ${result.mcVersion} / ${result.loaderType} — ${result.modCount} mod(s) detected`));
  if (!opts.dryRun) {
    console.log(chalk.gray(`  Next: review mcenv.yaml, then run \`mcenv install\`\n`));
  }
}

async function cmdInstall(
  opts: { file: string; output: string; ci: boolean; offline: boolean; docker: boolean },
  forceUpdate: boolean,
) {
  const configPath = resolve(opts.file);
  const serverDir = resolve(opts.output);
  const configDir = dirname(configPath);

  const verb = forceUpdate ? 'update' : 'install';
  console.log(chalk.bold(`\n  mcenv ${verb}\n`));

  // Load + validate
  process.stdout.write('  Reading config … ');
  const config = loadConfig(configPath);
  console.log(chalk.green(`${config.name} (MC ${config.minecraft_version} / ${config.loader.type})`));

  const warnings = validateCompatibility(config);
  for (const w of warnings) {
    if (w.level === 'error') throw new Error(w.message);
    console.log(chalk.yellow(`  ⚠  ${w.message}`));
  }

  const existingLock = forceUpdate ? null : readLockfile(configDir);
  if (existingLock && !forceUpdate) {
    console.log(chalk.gray(`  Using lockfile from ${existingLock.generated_at}`));
  }

  // Resolve
  process.stdout.write('  Resolving versions … ');
  const resolved = await resolveAll(config);
  console.log(chalk.green(`${resolved.length} artifacts`));

  // CI guard
  if (opts.ci && existingLock) {
    const newKeys = new Set(resolved.map((a) => slugify(a.name)));
    const removed = findRemovedArtifacts(existingLock, newKeys);
    if (removed.length > 0)
      throw new Error(`--ci: lockfile would change. Removed: ${removed.join(', ')}. Run mcenv update locally and commit the lockfile.`);
  }

  // Download
  console.log('  Downloading …');
  const locked = await downloadAll(resolved, serverDir, (name, done, total) => {
    const bar = progressBar(done, total, 20);
    process.stdout.write(`\r  ${bar} ${chalk.cyan(name.slice(0, 32).padEnd(32))} ${done}/${total}  `);
  });
  process.stdout.write('\r' + chalk.green('  ✓ Downloads complete') + ' '.repeat(50) + '\n');

  // Install
  process.stdout.write('  Installing server files … ');
  await setupServerDirectory(serverDir, config, locked, configDir);
  console.log(chalk.green('done'));

  // Write lockfile
  const lockfile = createLockfile(config.name, config.minecraft_version);
  for (const a of locked) lockfile.artifacts[slugify(a.name)] = a;
  writeLockfile(configDir, lockfile);
  console.log(chalk.green('  ✓ Lockfile saved → mcenv.lock.json'));

  if (opts.docker) {
    generateDockerfile(serverDir, config);
    console.log(chalk.green('  ✓ Dockerfile + docker-compose.yml generated'));
  }

  const startCmd = `cd ${serverDir} && ./start.sh`;
  console.log(chalk.bold(`\n  Ready → ${serverDir}`));
  console.log(chalk.gray(`  Start: ${startCmd}\n`));
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function blankStarterConfig(name: string): string {
  return `# mcenv.yaml — edit this file and run: mcenv install
name: ${name}
minecraft_version: "1.21.1"

loader:
  type: fabric        # vanilla | paper | fabric | forge | neoforge | quilt
  version: "*"        # loader version constraint — "*" = latest stable

java:
  version: "21"
  memory: "4G"        # sets -Xms and -Xmx

# Place plugin/mod config files in ./configs/ and they will be copied
# into the server directory on every install. Directory structure mirrors
# the server layout:
#   configs/plugins/LuckPerms/config.yml → server/plugins/LuckPerms/config.yml
#   configs/config/lithium.properties    → server/config/lithium.properties
config_dir: ./configs

server:
  difficulty: normal
  gamemode: survival
  max_players: 20
  online_mode: true
  pvp: true
  motd: "A Minecraft Server"
  view_distance: 10
  simulation_distance: 8

mods:
  - id: fabric-api
    source: modrinth
    version: "*"

  # Add more mods:
  # - id: lithium
  #   source: modrinth
  #   version: "*"
`;
}

function progressBar(done: number, total: number, width: number): string {
  const pct = total === 0 ? 1 : done / total;
  const filled = Math.round(pct * width);
  return chalk.green('[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']');
}

function slugify(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function dirSize(dirPath: string): number {
  let total = 0;
  for (const entry of readdirSync(dirPath)) {
    const p = join(dirPath, entry);
    const s = statSync(p);
    total += s.isDirectory() ? dirSize(p) : s.size;
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function bail(msg: string): never {
  console.error(chalk.yellow(`\n  ${msg}\n`));
  process.exit(1);
}

function fatal(err: unknown): never {
  console.error(chalk.red(`\n  Error: ${(err as Error).message}\n`));
  process.exit(1);
}
