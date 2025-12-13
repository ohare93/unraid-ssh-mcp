import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Platform, SSHExecutor } from "./platforms/types.js";

// Core tools - always loaded regardless of platform
import {
  registerDockerTools,
  registerSystemTools,
  registerMonitoringTools,
  registerSecurityTools,
  registerLogAnalysisTools,
  registerResourceManagementTools,
  registerPerformanceTools,
  registerVMTools,
  registerContainerTopologyTools,
  registerHealthDiagnosticsTools,
} from "./tools/core/index.js";

/**
 * Load all tools for a given platform
 *
 * 1. Load core tools (always loaded, work on any Linux system)
 * 2. Load platform-specific tools based on detected platform
 */
export function loadTools(
  server: McpServer,
  executor: SSHExecutor,
  platform: Platform
): void {
  // 1. Register core tools (always loaded)
  registerDockerTools(server, executor);
  registerSystemTools(server, executor);
  registerMonitoringTools(server, executor);
  registerSecurityTools(server, executor);
  registerLogAnalysisTools(server, executor);
  registerResourceManagementTools(server, executor);
  registerPerformanceTools(server, executor);
  registerVMTools(server, executor);
  registerContainerTopologyTools(server, executor);
  registerHealthDiagnosticsTools(server, executor);

  // 2. Register platform-specific tools
  const platformModules = platform.getToolModules();

  // Sort by priority (higher priority first)
  platformModules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const module of platformModules) {
    console.error(`Loading platform tool module: ${module.name}`);
    module.register(server, executor);
  }

  console.error(`Loaded tools for platform: ${platform.displayName}`);
}

/**
 * Count the total number of tools loaded
 */
export function countTools(platform: Platform): { core: number; platform: number; total: number } {
  // Core tools: 10 tools
  const core = 10;

  // Platform-specific tools count
  const platformCount = platform.getToolModules().length;

  return {
    core,
    platform: platformCount,
    total: core + platformCount,
  };
}
