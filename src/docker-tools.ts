import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all Docker debugging tools with the MCP server
 */
export function registerDockerTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: docker list containers - List all containers with status
  server.tool(
    "docker list containers",
    "List all Docker containers with their status. Returns container ID, name, image, status, state, and ports. Supports comprehensive output filtering.",
    {
      all: z.boolean().optional().default(true).describe("Show all containers (default: true). Set to false to show only running containers."),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const all = args.all ?? true;
        const command = all
          ? "docker ps -a --format json"
          : "docker ps --format json";

        const output = await sshExecutor(command);

        // Parse JSON lines and format output
        const lines = output
          .trim()
          .split("\n")
          .filter((line) => line.trim());
        if (lines.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No containers found.",
              },
            ],
          };
        }

        const containers = lines.map((line) => JSON.parse(line));
        let formatted = containers
          .map(
            (c) =>
              `ID: ${c.ID}\nName: ${c.Names}\nImage: ${c.Image}\nStatus: ${c.Status}\nState: ${c.State}\nPorts: ${c.Ports || "none"}\n`
          )
          .join("\n---\n\n");

        // Apply filters to formatted output
        formatted = applyFiltersToText(formatted, args);

        return {
          content: [
            {
              type: "text",
              text: `Docker Containers:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing containers: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: docker inspect - Get detailed container info
  server.tool(
    "docker inspect",
    "Get detailed information about a Docker container in JSON format. Includes configuration, state, network settings, mounts, and more. Supports comprehensive output filtering.",
    {
      container: z.string().describe("Container name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker inspect ${args.container}`;

        const output = await sshExecutor(command);

        // Pretty print the JSON output
        const inspectData = JSON.parse(output);
        let formatted = JSON.stringify(inspectData, null, 2);

        // Apply filters to formatted output
        formatted = applyFiltersToText(formatted, args);

        return {
          content: [
            {
              type: "text",
              text: `Docker Inspect - ${args.container}:\n\n${formatted}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error inspecting container: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: docker logs - Retrieve container logs
  server.tool(
    "docker logs",
    "Retrieve logs from a Docker container. Can filter by number of lines, time range, or use comprehensive output filters. Note: Docker-specific --tail/--since are separate from filter tail/head.",
    {
      container: z.string().describe("Container name or ID"),
      dockerTail: z.number().optional().describe("Docker-specific: Number of lines to show from end of logs (--tail flag)"),
      dockerSince: z.string().optional().describe("Docker-specific: Show logs since timestamp (e.g. 2013-01-02T13:23:37Z) or relative (e.g. 42m)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker logs ${args.container}`;

        if (args.dockerTail !== undefined) {
          command += ` --tail ${args.dockerTail}`;
        }
        if (args.dockerSince !== undefined) {
          command += ` --since ${args.dockerSince}`;
        }

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Docker Logs - ${args.container}:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: docker stats snapshot - Get current resource usage
  server.tool(
    "docker stats snapshot",
    "Get a snapshot of current resource usage for Docker containers. Shows CPU %, memory usage/limit, memory %, network I/O, and block I/O. Non-streaming, returns immediately. Supports comprehensive output filtering.",
    {
      container: z.string().optional().describe("Container name or ID (all containers if not specified)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker stats --no-stream";

        if (args.container) {
          command += ` ${args.container}`;
        }

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Docker Stats Snapshot:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting stats: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: docker port - Show port mappings
  server.tool(
    "docker port",
    "Show port mappings for a Docker container. Lists which container ports are mapped to which host ports. Supports comprehensive output filtering.",
    {
      container: z.string().describe("Container name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker port ${args.container}`;

        // Apply comprehensive filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        const result = output.trim() || "No port mappings found.";

        return {
          content: [
            {
              type: "text",
              text: `Docker Port Mappings - ${args.container}:\n\n${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting port mappings: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
