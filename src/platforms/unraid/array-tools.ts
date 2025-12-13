import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "../../filters.js";
import { SSHExecutor } from "../types.js";

const unraidActions = [
  "array_status", "smart", "temps", "shares", "share_usage",
  "parity_status", "parity_history", "sync_status", "spin_status",
  "unclean_check", "mover_status", "mover_log", "cache_usage", "split_level"
] as const;

export function registerUnraidArrayTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  server.tool(
    "unraid",
    "Unraid ops.",
    {
      action: z.enum(unraidActions).describe("Action"),
      device: z.string().optional().describe("Device"),
      share: z.string().optional().describe("Share name"),
      lines: z.number().int().positive().optional().default(100).describe("Lines"),
      limit: z.number().int().positive().optional().default(5).describe("Limit"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "array_status": {
            let output: string;
            try {
              let cmd = applyFilters("cat /proc/mdcmd", args);
              output = await sshExecutor(cmd);
            } catch {
              let cmd = applyFilters("mdcmd status", args);
              output = await sshExecutor(cmd);
            }
            return { content: [{ type: "text", text: `Array Status:\n\n${output}` }] };
          }

          case "smart": {
            if (!args.device) return { content: [{ type: "text", text: "Error: device required" }], isError: true };
            const isNvme = args.device.startsWith("nvme");
            const devicePath = `/dev/${args.device}`;
            let cmd = isNvme
              ? `smartctl -a -d nvme ${devicePath}`
              : `smartctl -a -d ata ${devicePath} || smartctl -a ${devicePath}`;
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `SMART - ${args.device}:\n\n${output}` }] };
          }

          case "temps": {
            let output = "=== System Temps ===\n\n";
            try {
              const sensors = await sshExecutor("sensors 2>/dev/null || echo 'sensors not available'");
              output += sensors + "\n\n";
            } catch { output += "Could not get system temps\n\n"; }

            try {
              const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
              const deviceList = devices.trim().split("\n").filter(d => d.trim());
              if (deviceList.length > 0) {
                output += "=== Drive Temps ===\n\n";
                for (const devicePath of deviceList) {
                  const deviceName = devicePath.replace("/dev/", "");
                  try {
                    const isNvme = deviceName.startsWith("nvme");
                    const smartCmd = isNvme
                      ? `smartctl -A -d nvme ${devicePath} | grep -i temperature || smartctl -A ${devicePath} | grep -i temperature`
                      : `smartctl -A -d ata ${devicePath} | grep -i temperature || smartctl -A ${devicePath} | grep -i temperature`;
                    const temp = await sshExecutor(smartCmd);
                    output += `${deviceName}:\n${temp}\n\n`;
                  } catch { output += `${deviceName}: Unable to read\n\n`; }
                }
              }
            } catch { output += "Could not get drive temps\n"; }
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "shares": {
            let cmd = applyFilters("ls -la /mnt/user/", args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `Shares:\n\n${output}` }] };
          }

          case "share_usage": {
            let cmd: string, title: string;
            if (args.share) {
              await sshExecutor(`test -d /mnt/user/${args.share}`);
              cmd = `du -sh /mnt/user/${args.share}`;
              title = `Share Usage - ${args.share}`;
            } else {
              cmd = "du -sh /mnt/user/*";
              title = "All Shares Usage";
            }
            cmd = applyFilters(cmd, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `${title}:\n\n${output}` }] };
          }

          case "parity_status": {
            let output = "=== Parity Status ===\n\n";
            try {
              const mdcmd = await sshExecutor("cat /proc/mdcmd");
              const lines = mdcmd.split("\n");
              const mdState = lines.find(l => l.startsWith("mdState="))?.split("=")[1];
              const mdResync = lines.find(l => l.startsWith("mdResync="))?.split("=")[1];
              const mdResyncPos = lines.find(l => l.startsWith("mdResyncPos="))?.split("=")[1];
              const mdResyncSize = lines.find(l => l.startsWith("mdResyncSize="))?.split("=")[1];
              const mdResyncAction = lines.find(l => l.startsWith("mdResyncAction="))?.split("=")[1];
              output += `State: ${mdState || "Unknown"}\n`;
              output += `Resync: ${mdResync === "0" ? "Not running" : "In progress"}\n`;
              if (mdResync !== "0" && mdResyncPos && mdResyncSize) {
                const pos = parseInt(mdResyncPos), size = parseInt(mdResyncSize);
                if (size > 0) {
                  output += `Action: ${mdResyncAction || "Parity Check"}\n`;
                  output += `Progress: ${((pos / size) * 100).toFixed(2)}%\n`;
                }
              }
            } catch { output += "Could not read /proc/mdcmd\n"; }
            try {
              const syslog = await sshExecutor("grep -i 'parity' /var/log/syslog | tail -n 20 || echo 'No entries'");
              output += "\n=== Recent Parity Logs ===\n\n" + syslog;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "parity_history": {
            const limit = args.limit ?? 5;
            let output = `=== Parity History (Last ${limit}) ===\n\n`;
            try {
              let cmd = applyFilters(`(cat /var/log/syslog; zcat /var/log/syslog.*.gz 2>/dev/null) | grep -i 'parity.*\\(finish\\|complete\\|done\\|error\\)' | tail -n ${limit * 3}`, args);
              const logs = await sshExecutor(cmd);
              output += logs.trim() ? logs : "No history found.\n";
            } catch { output += "Could not retrieve history.\n"; }
            return { content: [{ type: "text", text: output }] };
          }

          case "sync_status": {
            let output = "=== Sync/Rebuild Status ===\n\n";
            let cmd = applyFilters("cat /proc/mdcmd | grep -E '(mdState|mdResyncPos|mdResync|mdResyncAction|mdResyncSize)'", args);
            const mdcmd = await sshExecutor(cmd);
            output += mdcmd.trim() ? `${mdcmd}\n\n` : "No sync info.\n\n";
            const mdResync = mdcmd.split("\n").find(l => l.startsWith("mdResync="))?.split("=")[1];
            output += mdResync === "0" ? "No sync in progress.\n" : "Sync in progress!\n";
            try {
              const mdstat = await sshExecutor("cat /proc/mdstat");
              output += "\n=== MD Status ===\n\n" + mdstat;
            } catch {}
            return { content: [{ type: "text", text: output }] };
          }

          case "spin_status": {
            let output = "=== Spin Status ===\n\n";
            const devices = await sshExecutor("ls -1 /dev/sd? 2>/dev/null || echo ''");
            const deviceList = devices.trim().split("\n").filter(d => d.trim() && d.startsWith("/dev/"));
            if (deviceList.length === 0) { output += "No SATA drives.\n"; }
            else {
              for (const device of deviceList) {
                const deviceName = device.replace("/dev/", "");
                try {
                  const status = await sshExecutor(`hdparm -C ${device} 2>/dev/null`);
                  const statusLine = status.split("\n").find(l => l.includes("drive state"));
                  output += `${deviceName}: ${statusLine ? statusLine.trim() : status.trim()}\n`;
                } catch { output += `${deviceName}: Unable to check\n`; }
              }
            }
            try {
              const nvme = await sshExecutor("ls -1 /dev/nvme?n? 2>/dev/null || echo ''");
              const nvmeList = nvme.trim().split("\n").filter(d => d.trim() && d.startsWith("/dev/"));
              if (nvmeList.length > 0) {
                output += "\n=== NVMe Power ===\n\n";
                for (const device of nvmeList) {
                  const deviceName = device.replace("/dev/", "");
                  output += `${deviceName}: Active\n`;
                }
              }
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "unclean_check": {
            let output = "=== Unclean Shutdown Check ===\n\n";
            try {
              output += await sshExecutor("test -f /boot/unclean_shutdown && echo 'UNCLEAN MARKER FOUND' || echo 'No marker'") + "\n\n";
            } catch { output += "Could not check marker\n\n"; }
            try {
              const logs = await sshExecutor("grep -i '\\(shutdown\\|reboot\\|power\\)' /var/log/syslog | tail -n 20 || echo 'No entries'");
              output += "=== Recent Shutdown Events ===\n\n" + logs;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "mover_status": {
            let output = "=== Mover Status ===\n\n";
            try {
              const proc = await sshExecutor("ps aux | grep -v grep | grep mover || echo ''");
              output += proc.trim() ? `Status: RUNNING\n\n${proc}\n` : "Status: Not running\n\n";
            } catch { output += "Could not check process\n\n"; }
            try {
              const logs = await sshExecutor("grep -i 'mover' /var/log/syslog | tail -n 10 || echo 'No activity'");
              output += "=== Recent Activity ===\n\n" + logs;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "mover_log": {
            const lines = args.lines ?? 100;
            let cmd = applyFilters(`grep -i 'mover' /var/log/syslog | tail -n ${lines}`, args);
            const logs = await sshExecutor(cmd);
            const output = logs.trim() ? logs : "No mover log entries.\n";
            return { content: [{ type: "text", text: `Mover Log (${lines} lines):\n\n${output}` }] };
          }

          case "cache_usage": {
            let output = "=== Cache Usage ===\n\n";
            try {
              output += await sshExecutor("df -h /mnt/cache 2>/dev/null || df -h /mnt/cache* 2>/dev/null || echo 'Cache not mounted'") + "\n\n";
            } catch { output += "Could not get cache usage\n\n"; }
            try {
              const breakdown = await sshExecutor("du -sh /mnt/cache/* 2>/dev/null || echo 'No contents'");
              output += "=== Cache Contents ===\n\n" + breakdown;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "split_level": {
            let output = "";
            if (args.share) {
              output = `=== Split Level - ${args.share} ===\n\n`;
              try {
                const cfg = await sshExecutor(`cat /boot/config/shares/${args.share}.cfg 2>/dev/null || echo 'Not found'`);
                output += cfg + "\n";
              } catch { output += "Could not read config\n"; }
            } else {
              output = "=== Split Level - All Shares ===\n\n";
              try {
                const cfgs = await sshExecutor("ls -1 /boot/config/shares/*.cfg 2>/dev/null || echo 'No configs'");
                const files = cfgs.trim().split("\n").filter(f => f.endsWith(".cfg"));
                for (const file of files) {
                  const name = file.split("/").pop()?.replace(".cfg", "") || "unknown";
                  output += `--- ${name} ---\n`;
                  try {
                    const cfg = await sshExecutor(`cat "${file}"`);
                    const splitLevel = cfg.split("\n").find(l => l.includes("splitLevel"));
                    output += splitLevel ? `  ${splitLevel}\n` : "  splitLevel: not set\n";
                  } catch { output += "  Could not read\n"; }
                  output += "\n";
                }
              } catch { output += "Could not list configs\n"; }
            }
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
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
