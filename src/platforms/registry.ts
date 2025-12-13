import { Platform, SSHExecutor } from "./types.js";

/**
 * Platform Registry
 * Manages available platforms and handles auto-detection
 */
export class PlatformRegistry {
  private platforms: Map<string, Platform> = new Map();
  private detectedPlatform: Platform | null = null;

  /**
   * Register a platform
   */
  register(platform: Platform): void {
    this.platforms.set(platform.id, platform);
  }

  /**
   * Auto-detect the platform by running detection on all registered platforms
   * Returns the platform with the highest confidence score
   */
  async detect(executor: SSHExecutor): Promise<Platform> {
    const results: Array<{ platform: Platform; score: number }> = [];

    for (const platform of this.platforms.values()) {
      try {
        const score = await platform.detect(executor);
        console.error(`Platform ${platform.id}: score=${score}`);
        if (score > 0) {
          results.push({ platform, score });
        }
      } catch (error) {
        console.error(
          `Platform ${platform.id}: detection failed - ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      throw new Error(
        "No platform detected. Ensure you have at least the generic Linux platform registered."
      );
    }

    this.detectedPlatform = results[0].platform;

    console.error(
      `Platform detected: ${this.detectedPlatform.displayName} (confidence: ${results[0].score}%)`
    );

    return this.detectedPlatform;
  }

  /**
   * Get a platform by ID
   */
  get(id: string): Platform | undefined {
    return this.platforms.get(id);
  }

  /**
   * Get the detected platform (after detect() has been called)
   */
  getDetected(): Platform | null {
    return this.detectedPlatform;
  }

  /**
   * List all registered platforms
   */
  list(): Platform[] {
    return Array.from(this.platforms.values());
  }

  /**
   * Get platform IDs
   */
  listIds(): string[] {
    return Array.from(this.platforms.keys());
  }
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new PlatformRegistry();
