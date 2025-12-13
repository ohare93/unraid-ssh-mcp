import { Platform, PlatformToolModule, SSHExecutor } from "../types.js";
import { registerUnraidArrayTools } from "./array-tools.js";
import { registerUnraidPluginTools } from "./plugin-tools.js";

/**
 * Unraid Platform
 * Provides Unraid-specific tools for array management, parity operations,
 * cache/mover, plugins, and configuration.
 */
export const UnraidPlatform: Platform = {
  id: "unraid",
  displayName: "Unraid",

  capabilities: {
    storage: "mdraid",
    virtualization: "kvm",
    containerRuntime: "docker",
    initSystem: "sysv",
  },

  paths: {
    logDir: "/var/log",
    configDir: "/boot/config",
    dataDir: "/mnt/user",
    cacheDir: "/mnt/cache",
    containerDataDir: "/mnt/user/appdata",
  },

  /**
   * Detect Unraid by checking for Unraid-specific files and paths
   */
  async detect(executor: SSHExecutor): Promise<number> {
    let score = 0;

    // Check for /boot/config/ident.cfg (Unraid identity file)
    try {
      await executor("test -f /boot/config/ident.cfg");
      score += 35;
    } catch {
      // Not present
    }

    // Check for /proc/mdcmd (Unraid's custom kernel interface)
    try {
      await executor("test -f /proc/mdcmd");
      score += 35;
    } catch {
      // Not present
    }

    // Check for Unraid version file
    try {
      const version = await executor("cat /etc/unraid-version 2>/dev/null || echo ''");
      if (version.toLowerCase().includes("unraid")) {
        score += 30;
      }
    } catch {
      // Not present
    }

    // Check for Unraid plugin directory structure
    try {
      await executor("test -d /boot/config/plugins");
      score += 5;
    } catch {
      // Not present
    }

    return Math.min(score, 100);
  },

  /**
   * Get Unraid-specific tool modules
   */
  getToolModules(): PlatformToolModule[] {
    return [
      {
        name: "unraid",
        register: registerUnraidArrayTools,
        priority: 100,
      },
      {
        name: "plugin",
        register: registerUnraidPluginTools,
        priority: 90,
      },
    ];
  },
};
