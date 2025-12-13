// Platform abstraction layer exports
export type { Platform, PlatformCapability, PlatformPaths, PlatformToolModule, SSHExecutor } from "./types.js";
export { PlatformRegistry, platformRegistry } from "./registry.js";

// Platform implementations
import { LinuxPlatform } from "./linux/index.js";
import { UnraidPlatform } from "./unraid/index.js";
import { platformRegistry } from "./registry.js";

/**
 * Initialize the platform registry with all available platforms
 * Call this before using platform detection
 */
export function initializePlatforms(): void {
  // Register platforms (order doesn't matter - detection uses confidence scores)
  platformRegistry.register(LinuxPlatform);
  platformRegistry.register(UnraidPlatform);

  console.error(
    `Platform registry initialized with ${platformRegistry.listIds().length} platforms: ${platformRegistry.listIds().join(", ")}`
  );
}

// Re-export platform implementations for direct access if needed
export { LinuxPlatform } from "./linux/index.js";
export { UnraidPlatform } from "./unraid/index.js";
