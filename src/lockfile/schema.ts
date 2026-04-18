/**
 * Every artifact in the lockfile is pinned to an exact version + SHA-256 hash.
 * Same lockfile => identical server directory, byte-for-byte.
 */
export interface LockedArtifact {
  /** Human-readable label (e.g. "fabric-loader", "lithium") */
  name: string;
  /** Exact resolved version string */
  version: string;
  /** Canonical download URL */
  url: string;
  /** SHA-256 hex digest of the downloaded file */
  sha256: string;
  /** Relative destination path inside the server directory */
  dest: string;
  /** ISO timestamp of when this artifact was resolved */
  resolved_at: string;
}

export interface McEnvLockfile {
  /** Must match config.name — guards against stale lockfiles */
  name: string;
  /** Minecraft version this lockfile was generated for */
  minecraft_version: string;
  /** mcenv tool version that generated this file */
  mcenv_version: string;
  /** ISO timestamp of generation */
  generated_at: string;
  /** Map from artifact key to locked artifact */
  artifacts: Record<string, LockedArtifact>;
}
