import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register Docker network and volume tools with the MCP server
 */
export function registerDockerNetworkTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: docker list networks - List all Docker networks
  server.tool(
    "docker list networks",
    "List all Docker networks with their driver type and scope. Shows network ID, name, driver, and scope. Supports comprehensive output filtering.",
    {
      filter: z.string().optional().describe("Filter networks by driver (e.g., bridge, host, overlay)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker network ls";

        if (args.filter) {
          command += ` --filter driver=${args.filter}`;
        }

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Docker Networks:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing networks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: docker inspect network - Get detailed network information
  server.tool(
    "docker inspect network",
    "Get detailed information about a Docker network including connected containers, subnet, gateway, and configuration. Supports comprehensive output filtering.",
    {
      network: z.string().describe("Network name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker network inspect ${args.network}`;

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        // Pretty print the JSON output
        const inspectData = JSON.parse(output);
        const formatted = JSON.stringify(inspectData, null, 2);

        return {
          content: [
            {
              type: "text",
              text: `Docker Network Inspect - ${args.network}:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error inspecting network: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: docker list volumes - List all Docker volumes
  server.tool(
    "docker list volumes",
    "List all Docker volumes with their driver and mountpoint information. Supports comprehensive output filtering.",
    {
      dangling: z.boolean().optional().describe("Show only dangling (unused) volumes"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker volume ls";

        if (args.dangling === true) {
          command += " --filter dangling=true";
        } else if (args.dangling === false) {
          command += " --filter dangling=false";
        }

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Docker Volumes:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing volumes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: docker inspect volume - Get detailed volume information
  server.tool(
    "docker inspect volume",
    "Get detailed information about a Docker volume including mountpoint, driver, labels, and options. Supports comprehensive output filtering.",
    {
      volume: z.string().describe("Volume name"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker volume inspect ${args.volume}`;

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        // Pretty print the JSON output
        const inspectData = JSON.parse(output);
        const formatted = JSON.stringify(inspectData, null, 2);

        return {
          content: [
            {
              type: "text",
              text: `Docker Volume Inspect - ${args.volume}:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error inspecting volume: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: docker network containers - Show containers connected to a network
  server.tool(
    "docker network containers",
    "List all containers connected to a specific Docker network with their IP addresses. Supports comprehensive output filtering.",
    {
      network: z.string().describe("Network name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker network inspect ${args.network} --format '{{range $id, $container := .Containers}}{{$id}}: {{$container.Name}} ({{$container.IPv4Address}}){{println}}{{end}}'`;

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        const result = output.trim() || "No containers connected to this network.";

        return {
          content: [
            {
              type: "text",
              text: `Containers on network ${args.network}:\n\n${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting network containers: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
