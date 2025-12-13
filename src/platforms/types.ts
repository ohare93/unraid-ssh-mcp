import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Function type for executing SSH commands
 */
export type SSHExecutor = (command: string) => Promise<string>;

/**
 * Platform capabilities describing what features are available
 */
export interface PlatformCapability {
  /** Storage subsystem type */
  storage: "zfs" | "btrfs" | "mdraid" | "lvm" | "ext4" | "none";
  /** Virtualization technology */
  virtualization: "kvm" | "lxc" | "bhyve" | "none";
  /** Container runtime */
  containerRuntime: "docker" | "podman" | "containerd" | "none";
  /** Init system */
  initSystem: "systemd" | "openrc" | "sysv" | "freebsd-rc" | "launchd";
}

/**
 * Platform-specific filesystem paths
 */
export interface PlatformPaths {
  /** Log directory (e.g., /var/log) */
  logDir: string;
  /** Configuration directory */
  configDir: string;
  /** Data directory */
  dataDir: string;
  /** Cache directory (optional) */
  cacheDir?: string;
  /** Container data directory (optional) */
  containerDataDir?: string;
}

/**
 * Tool module that can be registered with the MCP server
 */
export interface PlatformToolModule {
  /** Module name for logging/debugging */
  name: string;
  /** Registration function */
  register: (server: McpServer, executor: SSHExecutor) => void;
  /** Priority (higher = registered first) */
  priority?: number;
}

/**
 * Platform definition interface
 */
export interface Platform {
  /** Unique identifier for the platform (e.g., 'unraid', 'truenas-scale') */
  id: string;

  /** Human-readable display name */
  displayName: string;

  /** Platform capabilities */
  capabilities: PlatformCapability;

  /** Platform-specific filesystem paths */
  paths: PlatformPaths;

  /**
   * Detect if this platform is running on the target system
   * @param executor SSH command executor
   * @returns Confidence score 0-100 (0 = definitely not, 100 = definitely yes)
   */
  detect(executor: SSHExecutor): Promise<number>;

  /**
   * Get platform-specific tool modules to register
   * @returns Array of tool modules
   */
  getToolModules(): PlatformToolModule[];
}
