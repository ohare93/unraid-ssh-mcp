import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyFilters, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const systemActions = ["list_files", "read_file", "find_files", "disk_usage", "system_info"] as const;

export function registerSystemTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  server.tool(
    "system",
    "System ops.",
    {
      action: z.enum(systemActions).describe("Action"),
      path: z.string().optional().describe("Path"),
      pattern: z.string().optional().describe("Pattern"),
      long: z.boolean().optional().describe("Long format"),
      maxLines: z.number().int().positive().optional().default(1000).describe("Max lines"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "list_files": {
            if (!args.path) return { content: [{ type: "text", text: "Error: path required" }], isError: true };
            let cmd = args.long ? `ls -lah "${args.path}"` : `ls "${args.path}"`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: output }] };
          }

          case "read_file": {
            if (!args.path) return { content: [{ type: "text", text: "Error: path required" }], isError: true };
            const maxLines = args.maxLines ?? 1000;
            let cmd = maxLines > 0 ? `head -n ${maxLines} "${args.path}"` : `cat "${args.path}"`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            const lineCount = output.split("\n").length;
            let result = output;
            if (!args.grep && !args.tail && !args.head && lineCount >= maxLines) {
              result += `\n\n[Limited to ${maxLines} lines]`;
            }
            return { content: [{ type: "text", text: result }] };
          }

          case "find_files": {
            if (!args.path || !args.pattern) return { content: [{ type: "text", text: "Error: path and pattern required" }], isError: true };
            let cmd = `find "${args.path}" -name "${args.pattern}" -type f 2>/dev/null`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            if (!output?.trim()) return { content: [{ type: "text", text: `No files matching "${args.pattern}" in ${args.path}` }] };
            const files = output.trim().split("\n");
            let result = output;
            if (files.length > 1000) {
              result = files.slice(0, 1000).join("\n") + `\n\n[Found ${files.length}, showing 1000]`;
            }
            return { content: [{ type: "text", text: result }] };
          }

          case "disk_usage": {
            const path = args.path ?? "/";
            let cmd = applyFilters(`df -h "${path}"`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: output }] };
          }

          case "system_info": {
            let cmd = applyFilters(`uname -a && echo "---" && uptime && echo "---" && free -h`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: output }] };
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
