export type LoaderType = 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' | 'quilt';
export type ModSource = 'modrinth' | 'curseforge' | 'url' | 'local';
export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export type LevelType = 'default' | 'flat' | 'largeBiomes' | 'amplified' | 'buffet';

export interface ModEntry {
  id: string;
  source: ModSource;
  /** Semver range, exact version string, or "*" for latest compatible */
  version: string;
  url?: string;    // required when source = url
  path?: string;   // required when source = local
  /** Skip gracefully instead of erroring when the mod isn't available */
  required?: boolean;
}

/** Complete server.properties — every vanilla key is represented */
export interface ServerProperties {
  // World
  level_name?: string;
  level_seed?: string | number;
  level_type?: LevelType;
  generator_settings?: string;
  generate_structures?: boolean;
  allow_nether?: boolean;
  max_world_size?: number;

  // Gameplay
  gamemode?: GameMode;
  force_gamemode?: boolean;
  difficulty?: Difficulty;
  hardcore?: boolean;
  pvp?: boolean;
  spawn_animals?: boolean;
  spawn_monsters?: boolean;
  spawn_npcs?: boolean;
  spawn_protection?: number;
  allow_flight?: boolean;
  enable_command_block?: boolean;
  function_permission_level?: number;
  op_permission_level?: number;

  // Players
  max_players?: number;
  online_mode?: boolean;
  white_list?: boolean;
  enforce_whitelist?: boolean;
  player_idle_timeout?: number;
  hide_online_players?: boolean;
  enforce_secure_profile?: boolean;

  // Network
  server_ip?: string;
  server_port?: number;
  network_compression_threshold?: number;
  prevent_proxy_connections?: boolean;
  use_native_transport?: boolean;
  rate_limit?: number;

  // Performance
  view_distance?: number;
  simulation_distance?: number;
  entity_broadcast_range_percentage?: number;
  max_tick_time?: number;
  max_chained_neighbor_updates?: number;
  sync_chunk_writes?: boolean;

  // Resource pack
  resource_pack?: string;
  resource_pack_sha1?: string;
  resource_pack_prompt?: string;
  require_resource_pack?: boolean;

  // RCON / Query
  enable_rcon?: boolean;
  rcon_port?: number;
  rcon_password?: string;
  broadcast_rcon_to_ops?: boolean;
  enable_query?: boolean;
  query_port?: number;

  // Misc
  motd?: string;
  enable_status?: boolean;
  enable_jmx_monitoring?: boolean;
  broadcast_console_to_ops?: boolean;
  previews_chat?: boolean;
  text_filtering_config?: string;
  initial_disabled_packs?: string;

  // Escape hatch: any extra key not listed above
  [key: string]: string | number | boolean | undefined;
}

export interface JavaConfig {
  version?: string;
  flags?: string[];
  /** Shorthand — sets -Xms and -Xmx to the same value (e.g. "4G") */
  memory?: string;
}

export interface WorldConfig {
  seed?: string | number;
  /** Download and extract a world zip from this URL */
  download_url?: string;
  /** Copy from a local path (directory or .zip) */
  local_path?: string;
}

export interface McEnvConfig {
  name: string;
  minecraft_version: string;

  loader: {
    type: LoaderType;
    version?: string;
  };

  /**
   * Path to a directory (relative to the config file) whose contents are
   * recursively copied into the server directory after jars are installed.
   * The directory structure mirrors the server layout:
   *
   *   configs/
   *     plugins/LuckPerms/config.yml   → server/plugins/LuckPerms/config.yml
   *     config/sodium-options.json     → server/config/sodium-options.json
   *     server.properties              → server/server.properties  (overrides generated)
   */
  config_dir?: string;

  mods?: ModEntry[];
  plugins?: ModEntry[];

  server?: ServerProperties;
  java?: JavaConfig;
  world?: WorldConfig;

  hooks?: {
    pre_install?: string;
    post_install?: string;
    pre_start?: string;
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const VALID_LOADERS: LoaderType[] = ['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'quilt'];
const VALID_SOURCES: ModSource[] = ['modrinth', 'curseforge', 'url', 'local'];
const MC_VERSION_RE = /^\d+\.\d+(\.\d+)?$/;

export function validateConfig(raw: unknown): McEnvConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error('Config must be an object');
  const c = raw as Record<string, unknown>;

  if (typeof c['name'] !== 'string' || !c['name']) throw new Error('Config.name is required');
  if (typeof c['minecraft_version'] !== 'string') throw new Error('Config.minecraft_version is required');
  if (!MC_VERSION_RE.test(c['minecraft_version'] as string))
    throw new Error(`Invalid minecraft_version: ${c['minecraft_version']}`);

  const loader = c['loader'] as Record<string, unknown> | undefined;
  if (!loader || typeof loader !== 'object') throw new Error('Config.loader is required');
  if (!VALID_LOADERS.includes(loader['type'] as LoaderType))
    throw new Error(`Invalid loader.type: ${loader['type']}. Must be one of: ${VALID_LOADERS.join(', ')}`);

  const allMods = [
    ...((c['mods'] as ModEntry[] | undefined) ?? []),
    ...((c['plugins'] as ModEntry[] | undefined) ?? []),
  ];

  for (const mod of allMods) {
    if (!mod.id) throw new Error(`Mod entry missing id: ${JSON.stringify(mod)}`);
    if (!VALID_SOURCES.includes(mod.source)) throw new Error(`Invalid source for mod ${mod.id}: ${mod.source}`);
    if (!mod.version) throw new Error(`Mod ${mod.id} missing version (use "*" for latest)`);
    if (mod.source === 'url' && !mod.url) throw new Error(`Mod ${mod.id} has source=url but no url field`);
    if (mod.source === 'local' && !mod.path) throw new Error(`Mod ${mod.id} has source=local but no path field`);
  }

  return raw as McEnvConfig;
}
