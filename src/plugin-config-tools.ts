import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote server
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all plugin and configuration management tools with the MCP server
 */
export function registerPluginConfigTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Plugin list plugins
  server.tool(
    "plugin list plugins",
    "List all installed Unraid plugins with their versions by reading from /boot/config/plugins/. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // List all plugin directories and get .plg files
        let command = `
          for dir in /boot/config/plugins/*/; do
            if [ -d "$dir" ]; then
              plugin_name=$(basename "$dir")
              plg_file=$(find "$dir" -maxdepth 1 -name "*.plg" -type f | head -n 1)

              if [ -n "$plg_file" ]; then
                # Extract version from .plg file
                version=$(grep -oP '(?<=version=")[^"]*' "$plg_file" 2>/dev/null | head -n 1)
                [ -z "$version" ] && version=$(grep -oP '(?<=<version>)[^<]*' "$plg_file" 2>/dev/null | head -n 1)
                [ -z "$version" ] && version="unknown"

                echo "$plugin_name|$version|$plg_file"
              else
                echo "$plugin_name|no-plg|$dir"
              fi
            fi
          done
        `.trim();

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output || output.trim() === "") {
          return {
            content: [
              {
                type: "text",
                text: "No plugins found in /boot/config/plugins/",
              },
            ],
          };
        }

        // Parse and format the output
        const lines = output.trim().split("\n");
        let formatted = "Installed Plugins:\n\n";

        for (const line of lines) {
          const [name, version, path] = line.split("|");
          formatted += `Plugin: ${name}\n`;
          formatted += `  Version: ${version}\n`;
          formatted += `  Path: ${path}\n\n`;
        }

        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Plugin check plugin updates
  server.tool(
    "plugin check plugin updates",
    "Check for available plugin updates by parsing .plg files for update URLs and comparing versions. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `
          for plg_file in /boot/config/plugins/*/*.plg; do
            if [ -f "$plg_file" ]; then
              plugin_name=$(basename "$(dirname "$plg_file")")

              # Get installed version
              version=$(grep -oP '(?<=version=")[^"]*' "$plg_file" 2>/dev/null | head -n 1)
              [ -z "$version" ] && version=$(grep -oP '(?<=<version>)[^<]*' "$plg_file" 2>/dev/null | head -n 1)
              [ -z "$version" ] && version="unknown"

              # Get update URL if exists
              update_url=$(grep -oP '(?<=updateurl=")[^"]*' "$plg_file" 2>/dev/null | head -n 1)
              [ -z "$update_url" ] && update_url=$(grep -oP '(?<=<updateurl>)[^<]*' "$plg_file" 2>/dev/null | head -n 1)
              [ -z "$update_url" ] && update_url="none"

              echo "$plugin_name|$version|$update_url"
            fi
          done
        `.trim();

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output || output.trim() === "") {
          return {
            content: [
              {
                type: "text",
                text: "No plugin files found",
              },
            ],
          };
        }

        // Parse and format the output
        const lines = output.trim().split("\n");
        let formatted = "Plugin Update Information:\n\n";

        for (const line of lines) {
          const [name, version, updateUrl] = line.split("|");
          formatted += `Plugin: ${name}\n`;
          formatted += `  Current Version: ${version}\n`;
          formatted += `  Update URL: ${updateUrl}\n`;
          formatted += `  Update Check: ${updateUrl !== "none" ? "Available" : "Not configured"}\n\n`;
        }

        formatted += "\nNote: To check actual version differences, the update URLs would need to be fetched and parsed.\n";

        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to check plugin updates: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Plugin read docker template
  server.tool(
    "plugin read docker template",
    "Read and parse a Docker template XML file from /boot/config/plugins/dockerMan/templates-user/. Supports comprehensive output filtering.",
    {
      template: z.string().describe("Template name (with or without .xml extension)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Add .xml extension if not present
        const templateName = args.template.endsWith(".xml")
          ? args.template
          : `${args.template}.xml`;

        const templatePath = `/boot/config/plugins/dockerMan/templates-user/${templateName}`;

        // Check if file exists and read it
        let command = `
          if [ -f "${templatePath}" ]; then
            cat "${templatePath}"
          else
            # Try to list available templates
            echo "Template not found. Available templates:"
            ls -1 /boot/config/plugins/dockerMan/templates-user/*.xml 2>/dev/null | xargs -n 1 basename 2>/dev/null || echo "No templates found"
          fi
        `.trim();

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
              text: `Failed to read Docker template: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Plugin list user scripts
  server.tool(
    "plugin list user scripts",
    "List all user scripts from /boot/config/plugins/user.scripts/scripts/ with their schedules and last run times. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `
          scripts_dir="/boot/config/plugins/user.scripts/scripts"

          if [ ! -d "$scripts_dir" ]; then
            echo "User scripts directory not found"
            exit 0
          fi

          for script_dir in "$scripts_dir"/*/; do
            if [ -d "$script_dir" ]; then
              script_name=$(basename "$script_dir")

              # Get script file
              script_file="$script_dir/script"

              # Get schedule if exists
              schedule_file="$script_dir/schedule"
              schedule="none"
              [ -f "$schedule_file" ] && schedule=$(cat "$schedule_file")

              # Get last run time if exists
              last_run="never"
              [ -f "$script_dir/lastrun" ] && last_run=$(cat "$script_dir/lastrun" 2>/dev/null)

              # Get description if exists
              description_file="$script_dir/description"
              description=""
              [ -f "$description_file" ] && description=$(cat "$description_file" 2>/dev/null)

              # Check if script exists
              exists="no"
              [ -f "$script_file" ] && exists="yes"

              echo "SCRIPT:$script_name"
              echo "EXISTS:$exists"
              echo "SCHEDULE:$schedule"
              echo "LASTRUN:$last_run"
              echo "DESCRIPTION:$description"
              echo "---"
            fi
          done
        `.trim();

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output || output.trim() === "" || output.includes("User scripts directory not found")) {
          return {
            content: [
              {
                type: "text",
                text: "No user scripts found or user.scripts plugin not installed",
              },
            ],
          };
        }

        // Parse and format the output
        const scripts = output.trim().split("---\n");
        let formatted = "User Scripts:\n\n";

        for (const scriptBlock of scripts) {
          if (!scriptBlock.trim()) continue;

          const lines = scriptBlock.trim().split("\n");
          const scriptData: Record<string, string> = {};

          for (const line of lines) {
            const [key, ...valueParts] = line.split(":");
            scriptData[key] = valueParts.join(":").trim();
          }

          if (scriptData.SCRIPT) {
            formatted += `Script: ${scriptData.SCRIPT}\n`;
            formatted += `  Exists: ${scriptData.EXISTS}\n`;
            formatted += `  Schedule: ${scriptData.SCHEDULE || "none"}\n`;
            formatted += `  Last Run: ${scriptData.LASTRUN || "never"}\n`;
            if (scriptData.DESCRIPTION) {
              formatted += `  Description: ${scriptData.DESCRIPTION}\n`;
            }
            formatted += "\n";
          }
        }

        return {
          content: [{ type: "text", text: formatted }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list user scripts: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Plugin check share config
  server.tool(
    "plugin check share config",
    "Validate share configurations from /boot/config/shares/*.cfg and check for misconfigurations. Supports comprehensive output filtering.",
    {
      share: z.string().optional().describe("Specific share name to check (optional, checks all if not specified)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const sharePattern = args.share
          ? `/boot/config/shares/${args.share}.cfg`
          : "/boot/config/shares/*.cfg";

        let command = `
          for cfg_file in ${sharePattern}; do
            if [ ! -f "$cfg_file" ]; then
              echo "No share configuration files found"
              exit 0
            fi

            share_name=$(basename "$cfg_file" .cfg)
            echo "=== Share: $share_name ==="
            echo ""

            # Read and display configuration
            while IFS='=' read -r key value; do
              # Skip comments and empty lines
              [[ "$key" =~ ^#.*$ ]] && continue
              [[ -z "$key" ]] && continue

              # Remove quotes from value
              value=$(echo "$value" | tr -d '"')

              echo "$key=$value"

              # Validation checks
              case "$key" in
                shareSplitLevel)
                  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
                    echo "  ⚠ WARNING: Split level should be numeric"
                  elif [ "$value" -gt 10 ]; then
                    echo "  ⚠ WARNING: Split level unusually high ($value)"
                  fi
                  ;;
                shareAllocator)
                  if [[ ! "$value" =~ ^(highwater|mostfree|fillup)$ ]]; then
                    echo "  ⚠ WARNING: Unknown allocator method: $value"
                  fi
                  ;;
                shareUseCache)
                  if [[ ! "$value" =~ ^(yes|no|only|prefer)$ ]]; then
                    echo "  ⚠ WARNING: Invalid cache setting: $value"
                  fi
                  ;;
                shareInclude)
                  if [ -z "$value" ]; then
                    echo "  ⚠ WARNING: No disks included in share"
                  fi
                  ;;
              esac
            done < "$cfg_file"

            echo ""
            echo "---"
            echo ""
          done
        `.trim();

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (output.includes("No share configuration files found")) {
          return {
            content: [
              {
                type: "text",
                text: args.share
                  ? `Share configuration not found: ${args.share}`
                  : "No share configurations found",
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to check share configuration: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Plugin check disk assignments
  server.tool(
    "plugin check disk assignments",
    "Verify disk assignments from /boot/config/disk.cfg showing array and cache disk assignments. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `
          disk_cfg="/boot/config/disk.cfg"

          if [ ! -f "$disk_cfg" ]; then
            echo "ERROR: disk.cfg not found"
            exit 1
          fi

          echo "=== Disk Assignments ==="
          echo ""

          # Parse disk.cfg
          while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ "$key" =~ ^#.*$ ]] && continue
            [[ -z "$key" ]] && continue

            # Remove quotes from value
            value=$(echo "$value" | tr -d '"')

            # Categorize and display
            if [[ "$key" =~ ^diskId\\. ]]; then
              disk_num=$(echo "$key" | cut -d. -f2)
              echo "Parity/Array Disk $disk_num: $value"
            elif [[ "$key" =~ ^cacheId\\. ]]; then
              cache_num=$(echo "$key" | cut -d. -f2)
              echo "Cache Disk $cache_num: $value"
            elif [[ "$key" =~ ^flashGUID ]]; then
              echo "Flash Drive: $value"
            elif [[ "$key" =~ ^disk ]]; then
              echo "$key: $value"
            fi
          done < "$disk_cfg"

          echo ""
          echo "=== Summary ==="

          # Count assignments
          parity_count=$(grep -c "^diskId\\." "$disk_cfg" 2>/dev/null || echo 0)
          cache_count=$(grep -c "^cacheId\\." "$disk_cfg" 2>/dev/null || echo 0)

          echo "Parity/Array Disks: $parity_count"
          echo "Cache Disks: $cache_count"
        `.trim();

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
              text: `Failed to check disk assignments: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Plugin find recent changes
  server.tool(
    "plugin find recent changes",
    "Find recently modified configuration files within a specified time period. Supports comprehensive output filtering.",
    {
      path: z
        .string()
        .optional()
        .default("/boot/config")
        .describe("Path to search for changes (default: /boot/config)"),
      hours: z
        .number()
        .int()
        .positive()
        .optional()
        .default(24)
        .describe("Number of hours to look back (default: 24)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const path = args.path ?? "/boot/config";
        const hours = args.hours ?? 24;
        const days = hours / 24;

        let command = `
          if [ ! -d "${path}" ]; then
            echo "ERROR: Path not found: ${path}"
            exit 1
          fi

          echo "=== Files modified in last ${hours} hours ==="
          echo "Searching in: ${path}"
          echo ""

          # Find files modified within the time period
          find "${path}" -type f -mtime -${days} -exec ls -lh {} \\; 2>/dev/null | sort -k6,7

          echo ""
          echo "=== Summary ==="
          count=$(find "${path}" -type f -mtime -${days} 2>/dev/null | wc -l)
          echo "Total files modified: $count"
        `.trim();

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (output.includes("Total files modified: 0")) {
          return {
            content: [
              {
                type: "text",
                text: `No files modified in the last ${hours} hours in ${path}`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to find recent changes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
