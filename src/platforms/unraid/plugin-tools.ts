import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyFilters, outputFiltersSchema } from "../../filters.js";
import { SSHExecutor } from "../types.js";

const pluginActions = ["list", "updates", "template", "scripts", "share_config", "disk_assignments", "recent_changes"] as const;

export function registerUnraidPluginTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "plugin",
    "Plugin/config ops.",
    {
      action: z.enum(pluginActions).describe("Action"),
      template: z.string().optional().describe("Template name"),
      share: z.string().optional().describe("Share name"),
      path: z.string().optional().default("/boot/config").describe("Path"),
      hours: z.number().int().positive().optional().default(24).describe("Hours"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "list": {
            let cmd = `for dir in /boot/config/plugins/*/; do if [ -d "$dir" ]; then plugin_name=$(basename "$dir"); plg_file=$(find "$dir" -maxdepth 1 -name "*.plg" -type f | head -n 1); if [ -n "$plg_file" ]; then version=$(grep -oP '(?<=version=")[^"]*' "$plg_file" 2>/dev/null | head -n 1); [ -z "$version" ] && version=$(grep -oP '(?<=<version>)[^<]*' "$plg_file" 2>/dev/null | head -n 1); [ -z "$version" ] && version="unknown"; echo "$plugin_name|$version|$plg_file"; else echo "$plugin_name|no-plg|$dir"; fi; fi; done`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            if (!output?.trim()) return { content: [{ type: "text", text: "No plugins found." }] };
            let formatted = "Plugins:\n\n";
            for (const line of output.trim().split("\n")) {
              const [name, version, path] = line.split("|");
              formatted += `${name}: ${version}\n  ${path}\n\n`;
            }
            return { content: [{ type: "text", text: formatted }] };
          }

          case "updates": {
            let cmd = `for plg_file in /boot/config/plugins/*/*.plg; do if [ -f "$plg_file" ]; then plugin_name=$(basename "$(dirname "$plg_file")"); version=$(grep -oP '(?<=version=")[^"]*' "$plg_file" 2>/dev/null | head -n 1); [ -z "$version" ] && version=$(grep -oP '(?<=<version>)[^<]*' "$plg_file" 2>/dev/null | head -n 1); [ -z "$version" ] && version="unknown"; update_url=$(grep -oP '(?<=updateurl=")[^"]*' "$plg_file" 2>/dev/null | head -n 1); [ -z "$update_url" ] && update_url=$(grep -oP '(?<=<updateurl>)[^<]*' "$plg_file" 2>/dev/null | head -n 1); [ -z "$update_url" ] && update_url="none"; echo "$plugin_name|$version|$update_url"; fi; done`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            if (!output?.trim()) return { content: [{ type: "text", text: "No plugins found." }] };
            let formatted = "Plugin Updates:\n\n";
            for (const line of output.trim().split("\n")) {
              const [name, version, url] = line.split("|");
              formatted += `${name}: ${version}\n  Update: ${url !== "none" ? "Available" : "Not configured"}\n\n`;
            }
            return { content: [{ type: "text", text: formatted }] };
          }

          case "template": {
            if (!args.template) return { content: [{ type: "text", text: "Error: template required" }], isError: true };
            const templateName = args.template.endsWith(".xml") ? args.template : `${args.template}.xml`;
            const templatePath = `/boot/config/plugins/dockerMan/templates-user/${templateName}`;
            let cmd = `if [ -f "${templatePath}" ]; then cat "${templatePath}"; else echo "Not found. Available:"; ls -1 /boot/config/plugins/dockerMan/templates-user/*.xml 2>/dev/null | xargs -n 1 basename 2>/dev/null || echo "None"; fi`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: output }] };
          }

          case "scripts": {
            let cmd = `scripts_dir="/boot/config/plugins/user.scripts/scripts"; if [ ! -d "$scripts_dir" ]; then echo "Not found"; exit 0; fi; for script_dir in "$scripts_dir"/*/; do if [ -d "$script_dir" ]; then script_name=$(basename "$script_dir"); schedule="none"; [ -f "$script_dir/schedule" ] && schedule=$(cat "$script_dir/schedule"); last_run="never"; [ -f "$script_dir/lastrun" ] && last_run=$(cat "$script_dir/lastrun" 2>/dev/null); echo "$script_name|$schedule|$last_run"; fi; done`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            if (!output?.trim() || output.includes("Not found")) return { content: [{ type: "text", text: "No user scripts found." }] };
            let formatted = "User Scripts:\n\n";
            for (const line of output.trim().split("\n")) {
              const [name, schedule, lastRun] = line.split("|");
              formatted += `${name}\n  Schedule: ${schedule}\n  Last Run: ${lastRun}\n\n`;
            }
            return { content: [{ type: "text", text: formatted }] };
          }

          case "share_config": {
            const sharePattern = args.share ? `/boot/config/shares/${args.share}.cfg` : "/boot/config/shares/*.cfg";
            let cmd = `for cfg_file in ${sharePattern}; do if [ ! -f "$cfg_file" ]; then echo "No configs"; exit 0; fi; share_name=$(basename "$cfg_file" .cfg); echo "=== $share_name ==="; cat "$cfg_file"; echo "---"; done`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            if (output.includes("No configs")) return { content: [{ type: "text", text: args.share ? `Share not found: ${args.share}` : "No share configs" }] };
            return { content: [{ type: "text", text: output }] };
          }

          case "disk_assignments": {
            let cmd = `disk_cfg="/boot/config/disk.cfg"; if [ ! -f "$disk_cfg" ]; then echo "disk.cfg not found"; exit 1; fi; echo "=== Disk Assignments ==="; cat "$disk_cfg" | grep -E "^(diskId|cacheId|flashGUID)"`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: output }] };
          }

          case "recent_changes": {
            const path = args.path ?? "/boot/config";
            const hours = args.hours ?? 24;
            const days = hours / 24;
            let cmd = `if [ ! -d "${path}" ]; then echo "Path not found: ${path}"; exit 1; fi; echo "=== Files modified in last ${hours}h ==="; find "${path}" -type f -mtime -${days} -exec ls -lh {} \\; 2>/dev/null | sort -k6,7; echo ""; count=$(find "${path}" -type f -mtime -${days} 2>/dev/null | wc -l); echo "Total: $count"`;
            cmd = applyFilters(cmd, args);
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
