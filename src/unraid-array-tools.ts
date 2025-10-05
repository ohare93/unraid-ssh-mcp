import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all Unraid array, parity, and mover tools with the MCP server
 */
export function registerUnraidArrayTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: unraid parity check status - Current/last parity check status
  server.tool(
    "unraid parity check status",
    "Get current or last parity check status including progress percentage, speed, errors found, and estimated completion time. Shows real-time information if a parity check is in progress. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "=== Parity Check Status ===\n\n";

        // Check /proc/mdcmd for current status
        try {
          let command = "cat /proc/mdcmd";
          command = applyFilters(command, args);
          const mdcmd = await sshExecutor(command);
          const lines = mdcmd.split("\n");

          // Parse relevant fields
          const mdState = lines.find(l => l.startsWith("mdState="))?.split("=")[1];
          const mdResync = lines.find(l => l.startsWith("mdResync="))?.split("=")[1];
          const mdResyncPos = lines.find(l => l.startsWith("mdResyncPos="))?.split("=")[1];
          const mdResyncSize = lines.find(l => l.startsWith("mdResyncSize="))?.split("=")[1];
          const mdResyncAction = lines.find(l => l.startsWith("mdResyncAction="))?.split("=")[1];

          output += `Array State: ${mdState || "Unknown"}\n`;
          output += `Resync/Parity Check: ${mdResync === "0" ? "Not running" : "In progress"}\n`;

          if (mdResync !== "0" && mdResyncPos && mdResyncSize) {
            const pos = parseInt(mdResyncPos);
            const size = parseInt(mdResyncSize);
            if (size > 0) {
              const progress = ((pos / size) * 100).toFixed(2);
              output += `Action: ${mdResyncAction || "Parity Check"}\n`;
              output += `Progress: ${progress}%\n`;
              output += `Position: ${pos} / ${size} blocks\n`;
            }
          }

          output += "\n";
        } catch (error) {
          output += "Could not read /proc/mdcmd\n\n";
        }

        // Check syslog for recent parity check information
        try {
          const syslog = await sshExecutor(
            "grep -i 'parity' /var/log/syslog | tail -n 20 || echo 'No recent parity check entries found'"
          );
          output += "=== Recent Parity Check Log Entries ===\n\n";
          output += syslog + "\n";
        } catch (error) {
          output += "Could not read syslog entries\n";
        }

        // Check mdstat for additional information
        try {
          const mdstat = await sshExecutor("cat /proc/mdstat");
          output += "\n=== MD Status ===\n\n";
          output += mdstat + "\n";
        } catch (error) {
          // mdstat is optional
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting parity check status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: unraid parity check history - Historical parity check results
  server.tool(
    "unraid parity check history",
    "Get historical parity check results showing date, duration, errors found, and speed for the last N parity checks. Parses system logs to provide a complete history. Supports comprehensive output filtering.",
    {
      limit: z.number().int().positive().optional().default(5).describe("Number of historical checks to show (default: 5)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const limit = args.limit ?? 5;
        let output = `=== Parity Check History (Last ${limit}) ===\n\n`;

        // Search syslog and archived logs for parity check completions
        try {
          let command = `(cat /var/log/syslog; zcat /var/log/syslog.*.gz 2>/dev/null) | grep -i 'parity.*\\(finish\\|complete\\|done\\|error\\)' | tail -n ${limit * 3}`;
          command = applyFilters(command, args);
          const logs = await sshExecutor(command);

          if (logs.trim()) {
            output += "Recent parity check events:\n\n";
            output += logs + "\n";
          } else {
            output += "No parity check history found in logs.\n";
          }
        } catch (error) {
          output += "Could not retrieve parity check history from logs.\n";
        }

        // Try to read parity check history file if it exists
        try {
          const historyFile = await sshExecutor("cat /boot/config/parity-checks.log 2>/dev/null || echo ''");
          if (historyFile.trim()) {
            output += "\n=== Parity Check History File ===\n\n";
            const lines = historyFile.split("\n").filter(l => l.trim());
            const recentLines = lines.slice(-limit);
            output += recentLines.join("\n") + "\n";
          }
        } catch (error) {
          // History file may not exist
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting parity check history: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: unraid array sync status - Real-time array sync/rebuild
  server.tool(
    "unraid array sync status",
    "Get real-time array synchronization or rebuild status. Shows progress, speed, and estimated time remaining for any ongoing sync operations. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "=== Array Sync/Rebuild Status ===\n\n";

        // Check /proc/mdcmd for sync status
        let command = "cat /proc/mdcmd | grep -E '(mdState|mdResyncPos|mdResync|mdResyncAction|mdResyncSize)'";
        command = applyFilters(command, args);
        const mdcmd = await sshExecutor(command);

        if (mdcmd.trim()) {
          output += "Current Status:\n";
          output += mdcmd + "\n\n";

          // Parse to provide human-readable summary
          const lines = mdcmd.split("\n");
          const mdResync = lines.find(l => l.startsWith("mdResync="))?.split("=")[1];

          if (mdResync === "0") {
            output += "No sync or rebuild in progress.\n";
          } else {
            output += "Sync/rebuild operation in progress!\n";
          }
        } else {
          output += "No sync information available.\n";
        }

        // Check /proc/mdstat for detailed progress
        try {
          const mdstat = await sshExecutor("cat /proc/mdstat");
          output += "\n=== Detailed MD Status ===\n\n";
          output += mdstat + "\n";
        } catch (error) {
          // mdstat optional
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting array sync status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: unraid disk spin status - Drive spin up/down status
  server.tool(
    "unraid disk spin status",
    "Check the spin status of all drives (active/standby/sleeping). Useful for monitoring which drives are spun down to save power and reduce wear. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "=== Disk Spin Status ===\n\n";

        // Get list of all sd* drives
        let command = "ls -1 /dev/sd? 2>/dev/null || echo ''";
        command = applyFilters(command, args);
        const devices = await sshExecutor(command);
        const deviceList = devices.trim().split("\n").filter(d => d.trim() && d.startsWith("/dev/"));

        if (deviceList.length === 0) {
          output += "No SATA drives found.\n";
        } else {
          for (const device of deviceList) {
            const deviceName = device.replace("/dev/", "");
            try {
              const status = await sshExecutor(`hdparm -C ${device} 2>/dev/null`);
              const statusLine = status.split("\n").find(l => l.includes("drive state"));
              output += `${deviceName}: ${statusLine ? statusLine.trim() : status.trim()}\n`;
            } catch (error) {
              output += `${deviceName}: Unable to check status\n`;
            }
          }
        }

        // Also check NVMe drives (they don't spin but have power states)
        try {
          const nvmeDevices = await sshExecutor("ls -1 /dev/nvme?n? 2>/dev/null || echo ''");
          const nvmeList = nvmeDevices.trim().split("\n").filter(d => d.trim() && d.startsWith("/dev/"));

          if (nvmeList.length > 0) {
            output += "\n=== NVMe Power States ===\n\n";
            for (const device of nvmeList) {
              const deviceName = device.replace("/dev/", "");
              try {
                const powerState = await sshExecutor(`nvme get-feature ${device} -f 2 -H 2>/dev/null | grep -i power || echo 'Active'`);
                output += `${deviceName}: ${powerState.trim() || "Active"}\n`;
              } catch (error) {
                output += `${deviceName}: Active (nvme command not available)\n`;
              }
            }
          }
        } catch (error) {
          // NVMe check is optional
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking disk spin status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: unraid unclean shutdown check - Check for unclean shutdowns
  server.tool(
    "unraid unclean shutdown check",
    "Check for unclean shutdowns by examining boot logs and system markers. Helps identify potential data integrity issues from improper shutdowns. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "=== Unclean Shutdown Check ===\n\n";

        // Check for unclean shutdown markers
        try {
          let command = "test -f /boot/unclean_shutdown && echo 'UNCLEAN SHUTDOWN MARKER FOUND' || echo 'No unclean shutdown marker'";
          command = applyFilters(command, args);
          const uncleanMarker = await sshExecutor(command);
          output += uncleanMarker + "\n\n";
        } catch (error) {
          output += "Could not check for unclean shutdown marker\n\n";
        }

        // Check boot logs
        try {
          const bootLogs = await sshExecutor("ls -lah /boot/logs/ 2>/dev/null || echo 'Boot logs directory not accessible'");
          output += "=== Boot Logs Directory ===\n\n";
          output += bootLogs + "\n\n";
        } catch (error) {
          output += "Could not access boot logs\n\n";
        }

        // Check syslog for shutdown/reboot entries
        try {
          const shutdownLogs = await sshExecutor(
            "grep -i '\\(shutdown\\|reboot\\|power\\)' /var/log/syslog | tail -n 20 || echo 'No shutdown entries found'"
          );
          output += "=== Recent Shutdown/Reboot Events ===\n\n";
          output += shutdownLogs + "\n\n";
        } catch (error) {
          output += "Could not check shutdown logs\n\n";
        }

        // Check for filesystem errors that might indicate unclean shutdown
        try {
          const fsckLogs = await sshExecutor(
            "dmesg | grep -i '\\(filesystem error\\|journal\\|ext4-fs error\\)' | tail -n 10 || echo 'No filesystem errors in dmesg'"
          );
          output += "=== Filesystem Error Check ===\n\n";
          output += fsckLogs + "\n";
        } catch (error) {
          output += "Could not check filesystem errors\n";
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking for unclean shutdown: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: unraid mover status - Mover status and last run
  server.tool(
    "unraid mover status",
    "Get mover status showing if it's currently running and when it last ran. The mover transfers files from cache to array disks. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "=== Mover Status ===\n\n";

        // Check if mover is currently running
        try {
          let command = "ps aux | grep -v grep | grep mover || echo ''";
          command = applyFilters(command, args);
          const moverProcess = await sshExecutor(command);
          if (moverProcess.trim()) {
            output += "Status: RUNNING\n\n";
            output += "Process details:\n";
            output += moverProcess + "\n\n";
          } else {
            output += "Status: Not running\n\n";
          }
        } catch (error) {
          output += "Could not check mover process\n\n";
        }

        // Check last mover run in syslog
        try {
          const moverLogs = await sshExecutor(
            "grep -i 'mover' /var/log/syslog | tail -n 10 || echo 'No recent mover activity found'"
          );
          output += "=== Recent Mover Activity ===\n\n";
          output += moverLogs + "\n\n";
        } catch (error) {
          output += "Could not retrieve mover logs\n\n";
        }

        // Check mover schedule
        try {
          const moverCron = await sshExecutor("grep -i mover /etc/cron.d/* 2>/dev/null || echo 'No mover cron jobs found'");
          output += "=== Mover Schedule ===\n\n";
          output += moverCron + "\n";
        } catch (error) {
          output += "Could not check mover schedule\n";
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting mover status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 7: unraid mover log - Read mover logs
  server.tool(
    "unraid mover log",
    "Read recent mover logs showing file transfer activity. Shows which files were moved from cache to array disks. Supports comprehensive output filtering.",
    {
      lines: z.number().int().positive().optional().default(100).describe("Number of log lines to show (default: 100)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const lines = args.lines ?? 100;
        let output = `=== Mover Log (Last ${lines} lines) ===\n\n`;

        // Extract mover entries from syslog
        let command = `grep -i 'mover' /var/log/syslog | tail -n ${lines}`;
        command = applyFilters(command, args);
        const logs = await sshExecutor(command);

        if (logs.trim()) {
          output += logs + "\n";
        } else {
          output += "No mover log entries found.\n";
          output += "\nNote: Mover logs are written to syslog. If no entries are found, the mover may not have run recently.\n";
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading mover log: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 8: unraid cache usage - Cache disk usage
  server.tool(
    "unraid cache usage",
    "Get cache disk usage and breakdown of what's stored on the cache. Shows total usage and size of each directory on cache. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "=== Cache Disk Usage ===\n\n";

        // Overall cache usage
        try {
          let command = "df -h /mnt/cache 2>/dev/null || df -h /mnt/cache* 2>/dev/null || echo 'Cache not mounted'";
          command = applyFilters(command, args);
          const cacheDF = await sshExecutor(command);
          output += "Cache filesystem:\n";
          output += cacheDF + "\n\n";
        } catch (error) {
          output += "Could not get cache filesystem usage\n\n";
        }

        // Breakdown by directory
        try {
          const cacheBreakdown = await sshExecutor("du -sh /mnt/cache/* 2>/dev/null || du -sh /mnt/cache*/* 2>/dev/null || echo 'No cache contents found'");
          output += "=== Cache Contents ===\n\n";
          output += cacheBreakdown + "\n\n";
        } catch (error) {
          output += "Could not get cache contents breakdown\n\n";
        }

        // Show cache pool information
        try {
          const cachePool = await sshExecutor("btrfs filesystem show /mnt/cache 2>/dev/null || echo 'Not a btrfs cache'");
          if (!cachePool.includes("Not a btrfs")) {
            output += "=== Cache Pool Info (btrfs) ===\n\n";
            output += cachePool + "\n";
          }
        } catch (error) {
          // Cache might not be btrfs
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting cache usage: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 9: unraid check split level - Verify share split level configs
  server.tool(
    "unraid check split level",
    "Verify share split level configurations. Split level controls how files are distributed across array disks. Can check a specific share or all shares. Supports comprehensive output filtering.",
    {
      share: z.string().optional().describe("Specific share name to check (optional, checks all shares if not specified)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let output = "";

        if (args.share) {
          // Check specific share
          output = `=== Split Level Config - ${args.share} ===\n\n`;

          try {
            let command = `cat /boot/config/shares/${args.share}.cfg 2>/dev/null || echo 'Share config not found'`;
            command = applyFilters(command, args);
            const shareConfig = await sshExecutor(command);

            if (shareConfig.includes("Share config not found")) {
              output += `Configuration file not found for share: ${args.share}\n`;
            } else {
              output += shareConfig + "\n\n";

              // Extract and highlight split level
              const splitLevel = shareConfig.split("\n").find(l => l.includes("splitLevel"));
              if (splitLevel) {
                output += `Split Level Setting: ${splitLevel}\n`;
              }
            }
          } catch (error) {
            output += `Could not read config for share: ${args.share}\n`;
          }
        } else {
          // Check all shares
          output = "=== Split Level Configs - All Shares ===\n\n";

          try {
            const shareConfigs = await sshExecutor("ls -1 /boot/config/shares/*.cfg 2>/dev/null || echo 'No share configs found'");
            const configFiles = shareConfigs.trim().split("\n").filter(f => f.endsWith(".cfg"));

            if (configFiles.length === 0 || shareConfigs.includes("No share configs found")) {
              output += "No share configuration files found.\n";
            } else {
              for (const configFile of configFiles) {
                const shareName = configFile.split("/").pop()?.replace(".cfg", "") || "unknown";
                output += `--- ${shareName} ---\n`;

                try {
                  const config = await sshExecutor(`cat "${configFile}"`);
                  const splitLevel = config.split("\n").find(l => l.includes("splitLevel"));
                  const useCache = config.split("\n").find(l => l.includes("shareUseCache"));

                  if (splitLevel) {
                    output += `  ${splitLevel}\n`;
                  } else {
                    output += "  splitLevel: not set (using default)\n";
                  }

                  if (useCache) {
                    output += `  ${useCache}\n`;
                  }

                  output += "\n";
                } catch (error) {
                  output += `  Could not read config\n\n`;
                }
              }
            }
          } catch (error) {
            output += "Could not list share configuration files\n";
          }
        }

        return {
          content: [
            {
              type: "text",
              text: output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking split level config: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
