import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote server
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all system tools with the MCP server
 */
export function registerSystemTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // System list files tool
  server.tool(
    "system list files",
    "List contents of a directory on the Unraid server. Use long format for detailed file information. Supports comprehensive output filtering.",
    {
      path: z.string().describe("Directory path to list"),
      long: z.boolean().optional().describe("Use long format with details (ls -lah)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = args.long ? `ls -lah "${args.path}"` : `ls "${args.path}"`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list files in ${args.path}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // System read file tool
  server.tool(
    "system read file",
    "Read contents of a file on the Unraid server. Limited to first N lines for safety (default: 1000). Supports comprehensive output filtering.",
    {
      path: z.string().describe("File path to read"),
      maxLines: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1000)
        .describe("Maximum number of lines to read (default: 1000)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const maxLines = args.maxLines ?? 1000;
        let command =
          maxLines > 0
            ? `head -n ${maxLines} "${args.path}"`
            : `cat "${args.path}"`;

        // Apply filters
        command = applyFilters(command, args);

        const output = await sshExecutor(command);

        // Add warning if file might be truncated (only if no filtering applied)
        const lineCount = output.split("\n").length;
        let result = output;
        if (!args.grep && !args.tail && !args.head && lineCount >= maxLines) {
          result += `\n\n[Note: Output limited to ${maxLines} lines. Use tail filter or increase maxLines.]`;
        }

        return {
          content: [{ type: "text", text: result }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to read file ${args.path}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // System find files tool
  server.tool(
    "system find files",
    "Search for files by name pattern in a directory and its subdirectories. Supports wildcards (*.log, etc.). Supports comprehensive output filtering.",
    {
      path: z.string().describe("Directory path to search in"),
      pattern: z.string().describe("File name pattern (supports wildcards like *.log)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `find "${args.path}" -name "${args.pattern}" -type f 2>/dev/null`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output || output.trim() === "") {
          return {
            content: [
              {
                type: "text",
                text: `No files matching pattern "${args.pattern}" found in ${args.path}`,
              },
            ],
          };
        }

        // Count and limit results for safety
        const files = output.trim().split("\n");
        const maxResults = 1000;

        let result = output;
        if (files.length > maxResults) {
          const truncated = files.slice(0, maxResults).join("\n");
          result = `${truncated}\n\n[Note: Found ${files.length} files, showing first ${maxResults} results]`;
        }

        return {
          content: [{ type: "text", text: result }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to find files matching "${args.pattern}" in ${args.path}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // System disk usage tool
  server.tool(
    "system disk usage",
    "Check disk usage and available space for a given path or filesystem. Supports comprehensive output filtering.",
    {
      path: z
        .string()
        .optional()
        .default("/")
        .describe("Path to check disk usage for (default: /)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const path = args.path ?? "/";
        let command = `df -h "${path}"`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to check disk usage for ${args.path ?? "/"}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // System get system info tool
  server.tool(
    "system get system info",
    "Get comprehensive Unraid system information including kernel version, uptime, and memory usage. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `uname -a && echo "---" && uptime && echo "---" && free -h`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get system info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
