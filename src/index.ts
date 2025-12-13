import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";
import { SSHConnectionManager } from "./ssh-manager.js";
import { initializePlatforms, platformRegistry, Platform } from "./platforms/index.js";
import { loadTools } from "./tool-loader.js";

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
    console.error("Connecting to SSH server...");
    await sshManager.connect();
    console.error("SSH connection established");
  } catch (error) {
    console.error(`Warning: Could not establish initial SSH connection: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Server will attempt to connect when first command is executed");
  }

  // Initialize platform registry
  console.error("Initializing platform registry...");
  initializePlatforms();

  // Create SSH executor adapter for tool modules
  // Converts SSHConnectionManager's full response to simple stdout string
  const sshExecutor = async (command: string): Promise<string> => {
    const result = await sshManager.executeCommand(command);
    if (result.exitCode !== 0 && result.stderr) {
      const cmdPreview = command.length > 100 ? command.substring(0, 100) + "..." : command;
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmdPreview}\n${result.stderr}`);
    }
    return result.stdout;
  };

  // Detect platform
  console.error("Detecting platform...");
  let detectedPlatform: Platform;
  try {
    detectedPlatform = await platformRegistry.detect(sshExecutor);
    console.error(`Detected platform: ${detectedPlatform.displayName} (${detectedPlatform.id})`);
  } catch (error) {
    console.error(`Platform detection failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Falling back to generic Linux platform");
    const fallback = platformRegistry.get("linux");
    if (!fallback) {
      throw new Error("Platform detection failed and no fallback platform available");
    }
    detectedPlatform = fallback;
  }

  // Create MCP server
  console.error("Initializing MCP server...");
  const server = new McpServer({
    name: "mcp-ssh-sre",
    version: "2.0.0",
  });

  // Load tools for detected platform
  console.error("Loading tools for platform...");
  loadTools(server, sshExecutor, detectedPlatform);
  console.error("All MCP tools registered");

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

  console.error(`MCP SSH SRE Server (stdio) ready`);
  console.error(`Platform: ${detectedPlatform.displayName} (${detectedPlatform.id})`);
}

// Start the server only if not in test environment
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
