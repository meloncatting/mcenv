import { McEnvConfig, LoaderType } from '../config/schema.js';

interface ValidationWarning {
  level: 'warn' | 'error';
  message: string;
}

/**
 * Pre-resolution validation: checks known incompatibilities and
 * configuration issues before touching the network.
 */
export function validateCompatibility(config: McEnvConfig): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const loader = config.loader.type;
  const mcVersion = config.minecraft_version;
  const [, minor] = mcVersion.split('.').map(Number) as [number, number, number | undefined];

  // Loader × MC version compatibility
  if (loader === 'fabric' || loader === 'quilt') {
    if (minor < 14) {
      warnings.push({ level: 'error', message: `Fabric/Quilt requires Minecraft 1.14+, got ${mcVersion}` });
    }
  }
  if (loader === 'neoforge') {
    if (minor < 20) {
      warnings.push({ level: 'error', message: `NeoForge requires Minecraft 1.20.1+, got ${mcVersion}` });
    }
  }
  if (loader === 'paper') {
    if (minor < 8) {
      warnings.push({ level: 'error', message: `Paper requires Minecraft 1.8+, got ${mcVersion}` });
    }
  }

  // Mod source compatibility warnings
  const mods = [...(config.mods ?? []), ...(config.plugins ?? [])];
  for (const mod of mods) {
    if (mod.source === 'modrinth' && (loader === 'forge' || loader === 'neoforge')) {
      // Forge mods on Modrinth use a different project type; warn if user adds Fabric mods
    }
    if (mod.source === 'curseforge') {
      warnings.push({
        level: 'warn',
        message: `Mod "${mod.id}" uses CurseForge — requires CURSEFORGE_API_KEY env var`,
      });
    }
  }

  // Java version recommendations
  const javaVer = parseInt(config.java?.version ?? '21', 10);
  if (minor >= 21 && javaVer < 21) {
    warnings.push({ level: 'warn', message: `MC 1.21+ works best with Java 21 (configured: ${javaVer})` });
  } else if (minor >= 17 && javaVer < 17) {
    warnings.push({ level: 'error', message: `MC 1.17+ requires Java 17+ (configured: ${javaVer})` });
  }

  // Memory sanity
  if (config.java?.memory) {
    const mem = parseMemory(config.java.memory);
    if (mem < 512) warnings.push({ level: 'warn', message: `Memory ${config.java.memory} is very low — recommend at least 1G` });
    if (mem > 16384) warnings.push({ level: 'warn', message: `Memory ${config.java.memory} is very high — ensure your host has enough RAM` });
  }

  // Plugin/mod loader mismatch
  if (config.plugins && config.plugins.length > 0 && !['paper', 'vanilla'].includes(loader as string)) {
    warnings.push({
      level: 'warn',
      message: `"plugins" list is for Paper/Bukkit. With ${loader}, use "mods" instead.`,
    });
  }

  return warnings;
}

function parseMemory(mem: string): number {
  const match = mem.match(/^(\d+)([GMgm]?)$/);
  if (!match) return 0;
  const n = parseInt(match[1]!, 10);
  const unit = match[2]?.toUpperCase();
  return unit === 'G' ? n * 1024 : n;
}
