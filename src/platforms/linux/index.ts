import { Platform, PlatformCapability, SSHExecutor } from "../types.js";

/**
 * Default capabilities - used as starting point for detection
 */
const DEFAULT_CAPABILITIES: PlatformCapability = {
  storage: "ext4",
  virtualization: "none",
  containerRuntime: "none",
  initSystem: "systemd",
};

/**
 * Detect available capabilities on the system
 * Returns a fresh capabilities object (doesn't mutate input)
 */
async function detectCapabilities(executor: SSHExecutor): Promise<PlatformCapability> {
  const capabilities: PlatformCapability = { ...DEFAULT_CAPABILITIES };

  // Detect container runtime
  try {
    await executor("command -v docker >/dev/null 2>&1");
    capabilities.containerRuntime = "docker";
  } catch {
    try {
      await executor("command -v podman >/dev/null 2>&1");
      capabilities.containerRuntime = "podman";
    } catch {
      capabilities.containerRuntime = "none";
    }
  }

  // Detect virtualization
  try {
    await executor("command -v virsh >/dev/null 2>&1");
    capabilities.virtualization = "kvm";
  } catch {
    try {
      await executor("test -d /sys/class/lxc");
      capabilities.virtualization = "lxc";
    } catch {
      capabilities.virtualization = "none";
    }
  }

  // Detect init system
  try {
    await executor("test -d /run/systemd/system");
    capabilities.initSystem = "systemd";
  } catch {
    try {
      await executor("test -f /sbin/openrc");
      capabilities.initSystem = "openrc";
    } catch {
      capabilities.initSystem = "sysv";
    }
  }

  // Detect storage subsystem
  try {
    await executor("command -v zpool >/dev/null 2>&1 && zpool list >/dev/null 2>&1");
    capabilities.storage = "zfs";
  } catch {
    try {
      await executor("test -f /proc/mdstat && grep -q md /proc/mdstat");
      capabilities.storage = "mdraid";
    } catch {
      try {
        await executor("command -v btrfs >/dev/null 2>&1 && btrfs filesystem show >/dev/null 2>&1");
        capabilities.storage = "btrfs";
      } catch {
        try {
          await executor("command -v lvs >/dev/null 2>&1 && lvs >/dev/null 2>&1");
          capabilities.storage = "lvm";
        } catch {
          capabilities.storage = "ext4";
        }
      }
    }
  }

  return capabilities;
}

/**
 * Generic Linux Platform
 * Serves as the baseline fallback when no specific platform is detected.
 * Provides core Linux/POSIX functionality that works on any Linux system.
 */
export const LinuxPlatform: Platform = {
  id: "linux",
  displayName: "Generic Linux",

  // Start with defaults - will be updated during detection
  capabilities: { ...DEFAULT_CAPABILITIES },

  paths: {
    logDir: "/var/log",
    configDir: "/etc",
    dataDir: "/home",
  },

  /**
   * Detect generic Linux
   * Always returns a low score (10) as the fallback platform
   * Also probes for capabilities like Docker and KVM
   */
  async detect(executor: SSHExecutor): Promise<number> {
    try {
      // Check if it's a Linux system
      const uname = await executor("uname -s 2>/dev/null || echo unknown");
      if (!uname.toLowerCase().includes("linux")) {
        return 0;
      }

      // Detect and update capabilities (creates fresh object)
      const detectedCapabilities = await detectCapabilities(executor);
      Object.assign(this.capabilities, detectedCapabilities);

      // Return low score - this is the fallback
      return 10;
    } catch {
      return 0;
    }
  },

  /**
   * No platform-specific tools for generic Linux
   * Core tools are always loaded separately
   */
  getToolModules() {
    return [];
  },
};
