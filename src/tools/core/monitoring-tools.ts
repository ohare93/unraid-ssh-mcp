import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const monitoringActions = ["ps", "process_tree", "top", "iostat", "network_connections"] as const;

export function registerMonitoringTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  server.tool(
    "monitoring",
    "Monitoring ops.",
    {
      action: z.enum(monitoringActions).describe("Action"),
      sortBy: z.enum(["cpu", "memory"]).optional().describe("Sort by"),
      count: z.number().int().positive().optional().default(20).describe("Count"),
      listening: z.boolean().optional().describe("Listening only"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "ps": {
            const count = args.count ?? 20;
            let cmd = "ps aux";
            if (args.sortBy === "cpu") cmd += " --sort=-%cpu";
            else if (args.sortBy === "memory") cmd += " --sort=-%mem";
            cmd += ` | head -n ${count + 1}`;  // +1 for header row
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Process List${args.sortBy ? ` (by ${args.sortBy})` : ""}:\n\n${output}` }] };
          }

          case "process_tree": {
            const count = args.count ?? 20;
            const cmd = `command -v pstree >/dev/null 2>&1 && pstree -p | head -n ${count} || ps auxf | head -n ${count + 1}`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Process Tree:\n\n${output}`, args) }] };
          }

          case "top": {
            const count = args.count ?? 20;
            let cmd = applyFilters(`top -b -n 1 | head -n ${count + 7}`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Top Processes (${count}):\n\n${output}` }] };
          }

          case "iostat": {
            let cmd = applyFilters("command -v iostat >/dev/null 2>&1 && iostat -x 1 1 || echo 'iostat not available'", args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Disk I/O:\n\n${output}` }] };
          }

          case "network_connections": {
            const count = args.count ?? 20;
            const ssCmd = args.listening ? "ss -tulnp" : "ss -tunap";
            const netstatCmd = args.listening ? "netstat -tulnp" : "netstat -tunap";
            const cmd = `command -v ss >/dev/null 2>&1 && ${ssCmd} | head -n ${count + 1} || ${netstatCmd} | head -n ${count + 1}`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Network${args.listening ? " (listening)" : ""}:\n\n${output}`, args) }] };
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
