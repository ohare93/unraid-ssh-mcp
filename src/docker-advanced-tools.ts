import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all advanced Docker debugging tools with the MCP server
 * All tools are READ-ONLY for safe inspection of Docker containers
 */
export function registerDockerAdvancedTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: docker container env - Show container environment variables
  server.tool(
    "docker container env",
    "Show all environment variables configured in a Docker container. Useful for debugging configuration issues and seeing what variables are available to the container's processes. Supports comprehensive output filtering.",
    {
      container: z.string().describe("Container name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' ${args.container}`;

        // Apply filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        const result = output.trim() || "No environment variables found.";

        return {
          content: [
            {
              type: "text",
              text: `Environment Variables - ${args.container}:\n\n${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving environment variables: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: docker top - Show processes inside container
  server.tool(
    "docker top",
    "Show all processes running inside a Docker container. Displays PID, user, and command for each process. Useful for understanding what's actually running in the container and debugging process-related issues. Supports comprehensive output filtering.",
    {
      container: z.string().describe("Container name or ID"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `docker top ${args.container}`;

        // Apply filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Processes in Container - ${args.container}:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving container processes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: docker health check all - Health status of all containers
  server.tool(
    "docker health check all",
    "Show health status of all Docker containers. Displays container name, running status, and health check status (if configured). Useful for quickly identifying unhealthy containers. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const command = "docker ps -a --format json";

        const output = await sshExecutor(command);

        // Parse JSON lines
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

        // Format health check information
        const healthInfo = containers
          .map((c) => {
            const health = c.Status.includes("(healthy)")
              ? "healthy"
              : c.Status.includes("(unhealthy)")
              ? "unhealthy"
              : c.Status.includes("(health: starting)")
              ? "starting"
              : "no healthcheck";

            return `Name: ${c.Names}\nState: ${c.State}\nHealth: ${health}\nStatus: ${c.Status}\n`;
          })
          .join("\n---\n\n");

        // Apply filters to formatted text
        const filtered = applyFiltersToText(`Container Health Status (${containers.length} containers):\n\n${healthInfo}`, args);

        return {
          content: [
            {
              type: "text",
              text: filtered,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving health status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: docker logs aggregate - Search logs across multiple containers
  server.tool(
    "docker logs aggregate",
    "Search for a pattern across logs of all running containers. Useful for finding which container is generating specific log messages or errors. Searches case-insensitively. Supports comprehensive output filtering.",
    {
      pattern: z.string().describe("Pattern to search for in logs (case-insensitive grep)"),
      lines: z.number().optional().default(100).describe("Number of log lines to check per container (default: 100)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const lines = args.lines ?? 100;

        // First, get list of running containers
        const listCommand = "docker ps --format '{{.Names}}'";
        const containerList = await sshExecutor(listCommand);

        const containers = containerList
          .trim()
          .split("\n")
          .filter((name) => name.trim());

        if (containers.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No running containers found.",
              },
            ],
          };
        }

        // Search logs in each container
        const results: string[] = [];
        for (const container of containers) {
          try {
            const logCommand = `docker logs --tail ${lines} ${container} 2>&1 | grep -i '${args.pattern}' || true`;
            const logOutput = await sshExecutor(logCommand);

            if (logOutput.trim()) {
              results.push(`=== ${container} ===\n${logOutput.trim()}\n`);
            }
          } catch (error) {
            // Skip containers that error (might be stopped or permission issues)
            continue;
          }
        }

        const resultText = results.length === 0
          ? `No matches found for pattern "${args.pattern}" in any container logs (searched ${containers.length} containers).`
          : `Log Search Results for "${args.pattern}" (found in ${results.length} of ${containers.length} containers):\n\n${results.join("\n")}`;

        // Apply filters to result
        const filtered = applyFiltersToText(resultText, args);

        return {
          content: [
            {
              type: "text",
              text: filtered,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error aggregating logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: docker compose ps - Show docker compose stack status
  server.tool(
    "docker compose ps",
    "Show status of containers that are part of a Docker Compose stack. If a compose file path is provided, it will check that specific stack. Otherwise, it attempts to find compose-managed containers. Supports comprehensive output filtering.",
    {
      composeFile: z
        .string()
        .optional()
        .describe("Optional path to docker-compose.yml file. If provided, will check if file exists and show containers from that stack."),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        if (args.composeFile) {
          // Check if the compose file exists
          const checkCommand = `test -f ${args.composeFile} && echo "exists" || echo "not found"`;
          const checkResult = await sshExecutor(checkCommand);

          if (checkResult.trim() !== "exists") {
            return {
              content: [
                {
                  type: "text",
                  text: `Compose file not found: ${args.composeFile}`,
                },
              ],
              isError: true,
            };
          }

          // Get the directory of the compose file to use as working directory
          const dirCommand = `dirname ${args.composeFile}`;
          const composeDir = (await sshExecutor(dirCommand)).trim();

          // Run docker compose ps from that directory
          const psCommand = `cd ${composeDir} && docker compose ps --format json`;
          const output = await sshExecutor(psCommand);

          if (!output.trim()) {
            return {
              content: [
                {
                  type: "text",
                  text: `No containers found for compose file: ${args.composeFile}`,
                },
              ],
            };
          }

          // Parse JSON lines
          const lines = output
            .trim()
            .split("\n")
            .filter((line) => line.trim());

          const containers = lines.map((line) => JSON.parse(line));

          const formatted = containers
            .map(
              (c) =>
                `Name: ${c.Name}\nService: ${c.Service}\nState: ${c.State}\nStatus: ${c.Status}\nPorts: ${c.Publishers?.map((p: any) => `${p.PublishedPort}->${p.TargetPort}`).join(", ") || "none"}\n`
            )
            .join("\n---\n\n");

          const fullText = `Docker Compose Stack - ${args.composeFile} (${containers.length} containers):\n\n${formatted}`;
          const filtered = applyFiltersToText(fullText, args);

          return {
            content: [
              {
                type: "text",
                text: filtered,
              },
            ],
          };
        } else {
          // Show all containers with compose labels
          const command = 'docker ps -a --filter "label=com.docker.compose.project" --format json';
          const output = await sshExecutor(command);

          if (!output.trim()) {
            return {
              content: [
                {
                  type: "text",
                  text: "No Docker Compose managed containers found.",
                },
              ],
            };
          }

          // Parse JSON lines
          const lines = output
            .trim()
            .split("\n")
            .filter((line) => line.trim());

          const containers = lines.map((line) => JSON.parse(line));

          const formatted = containers
            .map(
              (c) =>
                `Name: ${c.Names}\nImage: ${c.Image}\nState: ${c.State}\nStatus: ${c.Status}\nLabels: ${c.Labels}\n`
            )
            .join("\n---\n\n");

          const fullText = `Docker Compose Managed Containers (${containers.length}):\n\n${formatted}`;
          const filtered = applyFiltersToText(fullText, args);

          return {
            content: [
              {
                type: "text",
                text: filtered,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking compose stack: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: docker compose up - Start a docker compose stack
  server.tool(
    "docker compose up",
    "Start a Docker Compose stack. Takes a directory path and runs 'docker compose up'. Optionally specify detached mode (default: true) and custom compose file name. Supports comprehensive output filtering.",
    {
      path: z.string().describe("Directory path containing the docker-compose.yml file"),
      composeFile: z
        .string()
        .optional()
        .default("docker-compose.yml")
        .describe("Optional compose file name (default: docker-compose.yml)"),
      detached: z
        .boolean()
        .optional()
        .default(true)
        .describe("Run in detached mode (default: true). Set to false to run in foreground."),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const composeFile = args.composeFile ?? "docker-compose.yml";
        const detached = args.detached ?? true;

        // Check if the directory exists
        const dirCheckCommand = `test -d ${args.path} && echo "exists" || echo "not found"`;
        const dirCheckResult = await sshExecutor(dirCheckCommand);

        if (dirCheckResult.trim() !== "exists") {
          return {
            content: [
              {
                type: "text",
                text: `Directory not found: ${args.path}`,
              },
            ],
            isError: true,
          };
        }

        // Check if the compose file exists in that directory
        const composeFilePath = `${args.path}/${composeFile}`;
        const fileCheckCommand = `test -f ${composeFilePath} && echo "exists" || echo "not found"`;
        const fileCheckResult = await sshExecutor(fileCheckCommand);

        if (fileCheckResult.trim() !== "exists") {
          return {
            content: [
              {
                type: "text",
                text: `Compose file not found: ${composeFilePath}`,
              },
            ],
            isError: true,
          };
        }

        // Run docker compose up with or without -d flag
        const detachedFlag = detached ? " -d" : "";
        let upCommand = `cd ${args.path} && docker compose -f ${composeFile} up${detachedFlag}`;

        // Apply filters
        upCommand = applyFilters(upCommand, args);

        const output = await sshExecutor(upCommand);

        return {
          content: [
            {
              type: "text",
              text: `Docker Compose Up - ${args.path}\n\n${output.trim() || "Stack started successfully"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error starting compose stack: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
