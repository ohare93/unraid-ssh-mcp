import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const dockerActions = [
  "list_containers", "inspect", "logs", "stats", "port",
  "env", "top", "health", "logs_aggregate",
  "list_networks", "inspect_network", "list_volumes", "inspect_volume", "network_containers"
] as const;

export function registerDockerTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  server.tool(
    "docker",
    "Docker ops.",
    {
      action: z.enum(dockerActions).describe("Action"),
      container: z.string().optional().describe("Container"),
      network: z.string().optional().describe("Network"),
      volume: z.string().optional().describe("Volume"),
      all: z.boolean().optional().default(true).describe("Include stopped"),
      dockerTail: z.number().optional().describe("Lines (--tail)"),
      dockerSince: z.string().optional().describe("Since"),
      filter: z.string().optional().describe("Filter"),
      dangling: z.boolean().optional().describe("Dangling only"),
      pattern: z.string().optional().describe("Search pattern"),
      lines: z.number().optional().default(100).describe("Lines/container"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "list_containers": {
            const all = args.all ?? true;
            const cmd = all ? "docker ps -a --format json" : "docker ps --format json";
            const output = await sshExecutor(cmd);
            const lines = output.trim().split("\n").filter(l => l.trim());
            if (lines.length === 0) return { content: [{ type: "text", text: "No containers." }] };
            const containers = lines.map(l => JSON.parse(l));
            let formatted = containers.map(c =>
              `ID: ${c.ID}\nName: ${c.Names}\nImage: ${c.Image}\nStatus: ${c.Status}\nState: ${c.State}\nPorts: ${c.Ports || "none"}\n`
            ).join("\n---\n\n");
            formatted = applyFiltersToText(formatted, args);
            return { content: [{ type: "text", text: `Docker Containers:\n\n${formatted}` }] };
          }

          case "inspect": {
            if (!args.container) return { content: [{ type: "text", text: "Error: container required" }], isError: true };
            const output = await sshExecutor(`docker inspect ${args.container}`);
            let formatted = JSON.stringify(JSON.parse(output), null, 2);
            formatted = applyFiltersToText(formatted, args);
            return { content: [{ type: "text", text: `Docker Inspect - ${args.container}:\n\n${formatted}` }] };
          }

          case "logs": {
            if (!args.container) return { content: [{ type: "text", text: "Error: container required" }], isError: true };
            let cmd = `docker logs ${args.container}`;
            if (args.dockerTail !== undefined) cmd += ` --tail ${args.dockerTail}`;
            if (args.dockerSince !== undefined) cmd += ` --since ${args.dockerSince}`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Docker Logs - ${args.container}:\n\n${output}` }] };
          }

          case "stats": {
            let cmd = "docker stats --no-stream";
            if (args.container) cmd += ` ${args.container}`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Docker Stats:\n\n${output}` }] };
          }

          case "port": {
            if (!args.container) return { content: [{ type: "text", text: "Error: container required" }], isError: true };
            let cmd = applyFilters(`docker port ${args.container}`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Port Mappings - ${args.container}:\n\n${output.trim() || "None"}` }] };
          }

          case "env": {
            if (!args.container) return { content: [{ type: "text", text: "Error: container required" }], isError: true };
            let cmd = applyFilters(`docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' ${args.container}`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Env - ${args.container}:\n\n${output.trim() || "None"}` }] };
          }

          case "top": {
            if (!args.container) return { content: [{ type: "text", text: "Error: container required" }], isError: true };
            let cmd = applyFilters(`docker top ${args.container}`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Processes - ${args.container}:\n\n${output}` }] };
          }

          case "health": {
            const output = await sshExecutor("docker ps -a --format json");
            const lines = output.trim().split("\n").filter(l => l.trim());
            if (lines.length === 0) return { content: [{ type: "text", text: "No containers." }] };
            const containers = lines.map(l => JSON.parse(l));
            const healthInfo = containers.map(c => {
              const health = c.Status.includes("(healthy)") ? "healthy"
                : c.Status.includes("(unhealthy)") ? "unhealthy"
                : c.Status.includes("(health: starting)") ? "starting" : "no healthcheck";
              return `Name: ${c.Names}\nState: ${c.State}\nHealth: ${health}\n`;
            }).join("\n---\n\n");
            const filtered = applyFiltersToText(`Health Status:\n\n${healthInfo}`, args);
            return { content: [{ type: "text", text: filtered }] };
          }

          case "logs_aggregate": {
            if (!args.pattern) return { content: [{ type: "text", text: "Error: pattern required" }], isError: true };
            const containerList = await sshExecutor("docker ps --format '{{.Names}}'");
            const containers = containerList.trim().split("\n").filter(n => n.trim());
            if (containers.length === 0) return { content: [{ type: "text", text: "No running containers." }] };
            const results: string[] = [];
            for (const container of containers) {
              try {
                const logCmd = `docker logs --tail ${args.lines ?? 100} ${container} 2>&1 | grep -i '${args.pattern}' || true`;
                const logOutput = await sshExecutor(logCmd);
                if (logOutput.trim()) results.push(`=== ${container} ===\n${logOutput.trim()}\n`);
              } catch { continue; }
            }
            const text = results.length === 0
              ? `No matches for "${args.pattern}".`
              : `Search "${args.pattern}" (${results.length}/${containers.length}):\n\n${results.join("\n")}`;
            return { content: [{ type: "text", text: applyFiltersToText(text, args) }] };
          }

          case "list_networks": {
            let cmd = "docker network ls";
            if (args.filter) cmd += ` --filter driver=${args.filter}`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Docker Networks:\n\n${output}` }] };
          }

          case "inspect_network": {
            if (!args.network) return { content: [{ type: "text", text: "Error: network required" }], isError: true };
            const output = await sshExecutor(`docker network inspect ${args.network}`);
            let formatted = JSON.stringify(JSON.parse(output), null, 2);
            formatted = applyFiltersToText(formatted, args);
            return { content: [{ type: "text", text: `Network - ${args.network}:\n\n${formatted}` }] };
          }

          case "list_volumes": {
            let cmd = "docker volume ls";
            if (args.dangling === true) cmd += " --filter dangling=true";
            else if (args.dangling === false) cmd += " --filter dangling=false";
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Docker Volumes:\n\n${output}` }] };
          }

          case "inspect_volume": {
            if (!args.volume) return { content: [{ type: "text", text: "Error: volume required" }], isError: true };
            const output = await sshExecutor(`docker volume inspect ${args.volume}`);
            let formatted = JSON.stringify(JSON.parse(output), null, 2);
            formatted = applyFiltersToText(formatted, args);
            return { content: [{ type: "text", text: `Volume - ${args.volume}:\n\n${formatted}` }] };
          }

          case "network_containers": {
            if (!args.network) return { content: [{ type: "text", text: "Error: network required" }], isError: true };
            let cmd = applyFilters(`docker network inspect ${args.network} --format '{{range $id, $container := .Containers}}{{$id}}: {{$container.Name}} ({{$container.IPv4Address}}){{println}}{{end}}'`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Containers on ${args.network}:\n\n${output.trim() || "None"}` }] };
          }

          default:
            return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
