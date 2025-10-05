import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";
import { SSHConnectionManager } from "./ssh-manager.js";
import { registerDockerTools } from "./docker-tools.js";
import { registerDockerAdvancedTools } from "./docker-advanced-tools.js";
import { registerDockerNetworkTools } from "./docker-network-tools.js";
import { registerSystemTools } from "./system-tools.js";
import { registerUnraidTools } from "./unraid-tools.js";
import { registerUnraidArrayTools } from "./unraid-array-tools.js";
import { registerMonitoringTools } from "./monitoring-tools.js";
import { registerVMTools } from "./vm-tools.js";
import { registerContainerTopologyTools } from "./container-topology-tools.js";
import { registerPluginConfigTools } from "./plugin-config-tools.js";
import { registerPerformanceSecurityTools } from "./performance-security-tools.js";
import { registerLogAnalysisTools } from "./log-analysis-tools.js";
import { registerResourceManagementTools } from "./resource-management-tools.js";
import { registerHealthDiagnosticsTools } from "./health-diagnostics-tools.js";

// Re-export for backward compatibility
export { SSHConnectionManager };

/**
 * Main server function
 */
async function main() {
  // Initialize SSH connection manager
  const sshManager = new SSHConnectionManager();

  try {
    // Establish initial connection
    await sshManager.connect();
  } catch (error) {
    console.error(`Warning: Could not establish initial SSH connection: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Server will attempt to connect when first command is executed");
  }

  // Create MCP server
  const server = new McpServer({
    name: "ssh-unraid-server",
    version: "1.0.0",
  });

  // Create SSH executor adapter for tool modules
  // Converts SSHConnectionManager's full response to simple stdout string
  const sshExecutor = async (command: string): Promise<string> => {
    const result = await sshManager.executeCommand(command);
    if (result.exitCode !== 0 && result.stderr) {
      throw new Error(result.stderr);
    }
    return result.stdout;
  };

  // Register all Docker tools
  registerDockerTools(server, sshExecutor);

  // Register all advanced Docker tools
  registerDockerAdvancedTools(server, sshExecutor);

  // Register Docker network and volume tools
  registerDockerNetworkTools(server, sshExecutor);

  // Register all system tools
  registerSystemTools(server, sshExecutor);

  // Register all Unraid tools
  registerUnraidTools(server, sshExecutor);

  // Register all Unraid array, parity, and mover tools
  registerUnraidArrayTools(server, sshExecutor);

  // Register all monitoring tools
  registerMonitoringTools(server, sshExecutor);

  // Register all VM tools
  registerVMTools(server, sshExecutor);

  // Register all container topology tools
  registerContainerTopologyTools(server, sshExecutor);

  // Register all plugin and configuration management tools
  registerPluginConfigTools(server, sshExecutor);

  // Register all performance profiling and security audit tools
  registerPerformanceSecurityTools(server, sshExecutor);

  // Register all log analysis tools
  registerLogAnalysisTools(server, sshExecutor);

  // Register all resource management and optimization tools
  registerResourceManagementTools(server, sshExecutor);

  // Register all health diagnostics tools
  registerHealthDiagnosticsTools(server, sshExecutor);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.error("\nReceived SIGINT, shutting down gracefully...");
    await sshManager.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.error("\nReceived SIGTERM, shutting down gracefully...");
    await sshManager.disconnect();
    process.exit(0);
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("SSH Unraid MCP Server running on stdio");
}

// Start the server only if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
