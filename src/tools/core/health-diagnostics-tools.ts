import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

enum HealthStatus { OK = "OK", WARNING = "WARNING", CRITICAL = "CRITICAL" }
interface HealthCheckResult { category: string; status: HealthStatus; details: string; }

const healthActions = ["comprehensive", "common_issues", "threshold_alerts", "compare_baseline", "diagnostic_report", "snapshot"] as const;

export function registerHealthDiagnosticsTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "health",
    "Health ops.",
    {
      action: z.enum(healthActions).describe("Action"),
      cpuThreshold: z.number().min(0).max(100).optional().default(80).describe("CPU %"),
      memThreshold: z.number().min(0).max(100).optional().default(90).describe("Mem %"),
      diskThreshold: z.number().min(0).max(100).optional().default(90).describe("Disk %"),
      tempThreshold: z.number().min(0).max(100).optional().default(50).describe("Temp °C"),
      baselineFile: z.string().optional().default("/tmp/unraid-baseline.json").describe("Baseline file"),
      format: z.enum(["text", "markdown"]).optional().default("text").describe("Format"),
      name: z.string().optional().describe("Snapshot name"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "comprehensive": {
            const results: HealthCheckResult[] = [];
            // Array (Unraid-specific, but gracefully degrades)
            try {
              const arrayStatus = await sshExecutor("cat /proc/mdcmd 2>/dev/null || mdcmd status");
              const isStarted = arrayStatus.includes("mdState=STARTED");
              const parityMatch = arrayStatus.match(/sbSyncErrs=(\d+)/);
              const parityErrors = parityMatch ? parseInt(parityMatch[1]) : 0;
              let status = HealthStatus.OK, details = "Array running normally";
              if (!isStarted) { status = HealthStatus.CRITICAL; details = "Array not started"; }
              else if (parityErrors > 0) { status = HealthStatus.WARNING; details = `Parity errors: ${parityErrors}`; }
              results.push({ category: "Array", status, details });
            } catch { results.push({ category: "Array", status: HealthStatus.WARNING, details: "Unable to check" }); }
            // Temps
            try {
              const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
              const deviceList = devices.trim().split("\n").filter(d => d.trim());
              let maxTemp = 0;
              for (const devicePath of deviceList) {
                try {
                  const deviceName = devicePath.replace("/dev/", "");
                  const isNvme = deviceName.startsWith("nvme");
                  const smartCmd = isNvme ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1` : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;
                  const tempOutput = await sshExecutor(smartCmd);
                  const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);
                  if (tempMatch) { const temp = parseInt(tempMatch[1]); if (temp > maxTemp) maxTemp = temp; }
                } catch {}
              }
              let status = HealthStatus.OK, details = `Max temp: ${maxTemp}°C`;
              if (maxTemp > 60) { status = HealthStatus.CRITICAL; details = `Critical: ${maxTemp}°C`; }
              else if (maxTemp > 50) { status = HealthStatus.WARNING; details = `High: ${maxTemp}°C`; }
              results.push({ category: "Temps", status, details });
            } catch { results.push({ category: "Temps", status: HealthStatus.WARNING, details: "Unable to check" }); }
            // Disk
            try {
              const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
              const lines = dfOutput.trim().split("\n");
              let critical: string[] = [], warning: string[] = [];
              for (const line of lines) {
                const match = line.match(/(\S+)\s+\S+\s+\S+\s+\S+\s+(\d+)%/);
                if (match) {
                  const [, device, percent] = match;
                  const p = parseInt(percent);
                  if (p >= 95) critical.push(`${device}: ${p}%`);
                  else if (p >= 90) warning.push(`${device}: ${p}%`);
                }
              }
              let status = HealthStatus.OK, details = "Disk space OK";
              if (critical.length) { status = HealthStatus.CRITICAL; details = `Critical: ${critical.join(", ")}`; }
              else if (warning.length) { status = HealthStatus.WARNING; details = `Low: ${warning.join(", ")}`; }
              results.push({ category: "Disk", status, details });
            } catch { results.push({ category: "Disk", status: HealthStatus.WARNING, details: "Unable to check" }); }
            // Containers
            try {
              const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}},{{.State}},{{.Status}}'");
              const containers = containersOutput.trim().split("\n").filter(l => l.trim());
              let exited: string[] = [], restarting: string[] = [];
              for (const c of containers) {
                const [name, state, status] = c.split(",");
                if (state === "exited") exited.push(name);
                else if (state === "restarting" || status?.includes("Restarting")) restarting.push(name);
              }
              let status = HealthStatus.OK, details = `${containers.length} containers OK`;
              if (restarting.length) { status = HealthStatus.CRITICAL; details = `Restarting: ${restarting.join(", ")}`; }
              else if (exited.length) { status = HealthStatus.WARNING; details = `Stopped: ${exited.join(", ")}`; }
              results.push({ category: "Containers", status, details });
            } catch { results.push({ category: "Containers", status: HealthStatus.WARNING, details: "Unable to check" }); }
            // Resources
            try {
              const topOutput = await sshExecutor("top -b -n 1 | head -5");
              const cpuMatch = topOutput.match(/Cpu\(s\):\s*([\d.]+)\s*us/i);
              const memMatch = topOutput.match(/Mem\s*:\s*(\d+)\s+total,\s*(\d+)\s+free/i);
              let cpuPercent = cpuMatch ? parseFloat(cpuMatch[1]) : 0;
              let memPercent = memMatch ? ((parseInt(memMatch[1]) - parseInt(memMatch[2])) / parseInt(memMatch[1])) * 100 : 0;
              let status = HealthStatus.OK, details = `CPU: ${cpuPercent.toFixed(1)}%, Mem: ${memPercent.toFixed(1)}%`;
              if (cpuPercent > 90 || memPercent > 95) { status = HealthStatus.CRITICAL; details = `Critical! ${details}`; }
              else if (cpuPercent > 80 || memPercent > 90) { status = HealthStatus.WARNING; details = `High: ${details}`; }
              results.push({ category: "Resources", status, details });
            } catch { results.push({ category: "Resources", status: HealthStatus.WARNING, details: "Unable to check" }); }
            const summary = results.map(r => `[${r.status}] ${r.category}: ${r.details}`).join("\n");
            const overall = results.some(r => r.status === HealthStatus.CRITICAL) ? "CRITICAL" : results.some(r => r.status === HealthStatus.WARNING) ? "WARNING" : "OK";
            return { content: [{ type: "text", text: applyFiltersToText(`=== Health Check ===\n\nOverall: ${overall}\n\n${summary}`, args) }] };
          }

          case "common_issues": {
            const issues: string[] = [];
            // High temps
            try {
              const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
              for (const devicePath of devices.trim().split("\n").filter(d => d.trim())) {
                try {
                  const deviceName = devicePath.replace("/dev/", "");
                  const isNvme = deviceName.startsWith("nvme");
                  const smartCmd = isNvme ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1` : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;
                  const tempOutput = await sshExecutor(smartCmd);
                  const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);
                  if (tempMatch) {
                    const temp = parseInt(tempMatch[1]);
                    if (temp > 60) issues.push(`[CRITICAL] ${deviceName}: ${temp}°C`);
                    else if (temp > 50) issues.push(`[HIGH] ${deviceName}: ${temp}°C`);
                  }
                } catch {}
              }
            } catch {}
            // Disk space
            try {
              const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
              for (const line of dfOutput.trim().split("\n")) {
                const match = line.match(/(\S+)\s+\S+\s+\S+\s+\S+\s+(\d+)%/);
                if (match) {
                  const p = parseInt(match[2]);
                  if (p >= 95) issues.push(`[CRITICAL] Disk ${match[1]}: ${p}%`);
                  else if (p >= 90) issues.push(`[HIGH] Disk ${match[1]}: ${p}%`);
                }
              }
            } catch {}
            // Container restarts
            try {
              const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}},{{.State}},{{.Status}}'");
              for (const c of containersOutput.trim().split("\n").filter(l => l.trim())) {
                const [name, state, status] = c.split(",");
                if (state === "restarting" || status?.includes("Restarting")) issues.push(`[CRITICAL] Container ${name} restarting`);
              }
            } catch {}
            if (issues.length === 0) return { content: [{ type: "text", text: applyFiltersToText("=== Issues Detection ===\n\nNo issues detected.", args) }] };
            return { content: [{ type: "text", text: applyFiltersToText(`=== Issues Detection ===\n\n${issues.length} issue(s):\n\n${issues.join("\n")}`, args) }] };
          }

          case "threshold_alerts": {
            const cpuThreshold = args.cpuThreshold ?? 80;
            const memThreshold = args.memThreshold ?? 90;
            const diskThreshold = args.diskThreshold ?? 90;
            const tempThreshold = args.tempThreshold ?? 50;
            const alerts: string[] = [];
            // CPU
            try {
              const topOutput = await sshExecutor("top -b -n 1 | head -5");
              const cpuMatch = topOutput.match(/Cpu\(s\):\s*([\d.]+)\s*us/i);
              if (cpuMatch) {
                const cpu = parseFloat(cpuMatch[1]);
                if (cpu > cpuThreshold) alerts.push(`CPU ${cpu.toFixed(1)}% > ${cpuThreshold}%`);
              }
            } catch {}
            // Memory
            try {
              const memOutput = await sshExecutor("free | grep Mem:");
              const memMatch = memOutput.match(/Mem:\s*(\d+)\s+(\d+)/);
              if (memMatch) {
                const mem = (parseInt(memMatch[2]) / parseInt(memMatch[1])) * 100;
                if (mem > memThreshold) alerts.push(`Memory ${mem.toFixed(1)}% > ${memThreshold}%`);
              }
            } catch {}
            // Disk
            try {
              const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
              for (const line of dfOutput.trim().split("\n")) {
                const match = line.match(/(\S+)\s+\S+\s+\S+\s+\S+\s+(\d+)%/);
                if (match && parseInt(match[2]) > diskThreshold) alerts.push(`Disk ${match[1]} ${match[2]}% > ${diskThreshold}%`);
              }
            } catch {}
            // Temps
            try {
              const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
              for (const devicePath of devices.trim().split("\n").filter(d => d.trim())) {
                try {
                  const deviceName = devicePath.replace("/dev/", "");
                  const isNvme = deviceName.startsWith("nvme");
                  const smartCmd = isNvme ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1` : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;
                  const tempOutput = await sshExecutor(smartCmd);
                  const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);
                  if (tempMatch) {
                    const temp = parseInt(tempMatch[1]);
                    if (temp > tempThreshold) alerts.push(`Drive ${deviceName} ${temp}°C > ${tempThreshold}°C`);
                  }
                } catch {}
              }
            } catch {}
            const header = `=== Threshold Alerts ===\n\nThresholds: CPU ${cpuThreshold}%, Mem ${memThreshold}%, Disk ${diskThreshold}%, Temp ${tempThreshold}°C\n\n`;
            if (alerts.length === 0) return { content: [{ type: "text", text: applyFiltersToText(header + "No thresholds exceeded.", args) }] };
            return { content: [{ type: "text", text: applyFiltersToText(header + `${alerts.length} Alert(s):\n\n${alerts.join("\n")}`, args) }] };
          }

          case "compare_baseline": {
            const baselineFile = args.baselineFile ?? "/tmp/unraid-baseline.json";
            const currentState: any = { timestamp: new Date().toISOString() };
            try {
              const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}}'");
              currentState.containerCount = containersOutput.trim().split("\n").filter(l => l.trim()).length;
              const runningOutput = await sshExecutor("docker ps --format '{{.Names}}'");
              currentState.runningContainers = runningOutput.trim().split("\n").filter(l => l.trim()).length;
            } catch { currentState.containerCount = 0; currentState.runningContainers = 0; }
            try {
              const dfOutput = await sshExecutor("df -h / | tail -1");
              const match = dfOutput.match(/\S+\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)%/);
              if (match) currentState.rootDiskPercent = parseInt(match[3]);
            } catch { currentState.rootDiskPercent = 0; }
            let baseline: any = null;
            try {
              const baselineJson = await sshExecutor(`cat ${baselineFile}`);
              baseline = JSON.parse(baselineJson);
            } catch {
              try {
                const escapedJson = JSON.stringify(currentState, null, 2).replace(/'/g, "'\"'\"'");
                await sshExecutor(`echo '${escapedJson}' > ${baselineFile}`);
                return { content: [{ type: "text", text: applyFiltersToText(`=== Baseline ===\n\nNo baseline found. Saved current state to ${baselineFile}\n\n${JSON.stringify(currentState, null, 2)}`, args) }] };
              } catch (e) { throw new Error(`Failed to save baseline: ${e}`); }
            }
            const changes: string[] = [];
            if (currentState.containerCount !== baseline.containerCount) changes.push(`Containers: ${baseline.containerCount} -> ${currentState.containerCount}`);
            if (currentState.runningContainers !== baseline.runningContainers) changes.push(`Running: ${baseline.runningContainers} -> ${currentState.runningContainers}`);
            if (currentState.rootDiskPercent !== baseline.rootDiskPercent) changes.push(`Disk: ${baseline.rootDiskPercent}% -> ${currentState.rootDiskPercent}%`);
            if (changes.length === 0) return { content: [{ type: "text", text: applyFiltersToText(`=== Baseline Comparison ===\n\nNo significant changes.`, args) }] };
            return { content: [{ type: "text", text: applyFiltersToText(`=== Baseline Comparison ===\n\n${changes.length} change(s):\n\n${changes.join("\n")}`, args) }] };
          }

          case "diagnostic_report": {
            const isMarkdown = args.format === "markdown";
            let report = isMarkdown ? "# Diagnostic Report\n\n" : "=== Diagnostic Report ===\n\n";
            report += `Generated: ${new Date().toLocaleString()}\n\n`;
            try {
              const uname = await sshExecutor("uname -a");
              report += isMarkdown ? `**Kernel:** ${uname}\n\n` : `Kernel: ${uname}\n`;
              const uptime = await sshExecutor("uptime");
              report += isMarkdown ? `**Uptime:** ${uptime}\n\n` : `Uptime: ${uptime}\n`;
            } catch {}
            try {
              const arrayStatus = await sshExecutor("cat /proc/mdcmd 2>/dev/null || mdcmd status");
              report += isMarkdown ? `## Array\n\n\`\`\`\n${arrayStatus}\n\`\`\`\n\n` : `--- Array ---\n\n${arrayStatus}\n\n`;
            } catch {}
            try {
              const containers = await sshExecutor("docker ps -a --format 'table {{.Names}}\t{{.State}}\t{{.Status}}'");
              report += isMarkdown ? `## Containers\n\n\`\`\`\n${containers}\n\`\`\`\n\n` : `--- Containers ---\n\n${containers}\n\n`;
            } catch {}
            try {
              const df = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)|Filesystem'");
              report += isMarkdown ? `## Disk\n\n\`\`\`\n${df}\n\`\`\`\n\n` : `--- Disk ---\n\n${df}\n\n`;
            } catch {}
            try {
              const mem = await sshExecutor("free -h");
              report += isMarkdown ? `## Memory\n\n\`\`\`\n${mem}\n\`\`\`\n\n` : `--- Memory ---\n\n${mem}\n\n`;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
          }

          case "snapshot": {
            const snapshot: any = { timestamp: new Date().toISOString(), containers: { running: 0, stopped: 0, total: 0, list: [] }, diskUsage: [], memory: {}, uptime: "" };
            try {
              const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}},{{.State}}'");
              const containers = containersOutput.trim().split("\n").filter(l => l.trim());
              snapshot.containers.total = containers.length;
              for (const c of containers) {
                const [name, state] = c.split(",");
                snapshot.containers.list.push(`${name}: ${state}`);
                if (state === "running") snapshot.containers.running++;
                else snapshot.containers.stopped++;
              }
            } catch {}
            try {
              const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
              for (const line of dfOutput.trim().split("\n")) {
                const match = line.match(/(\S+)\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)%/);
                if (match) snapshot.diskUsage.push({ path: match[1], used: match[2], available: match[3], usePercent: match[4] });
              }
            } catch {}
            try {
              const memOutput = await sshExecutor("free -h | grep Mem:");
              const memMatch = memOutput.match(/Mem:\s*(\S+)\s+(\S+)\s+(\S+)/);
              if (memMatch) { snapshot.memory.total = memMatch[1]; snapshot.memory.used = memMatch[2]; snapshot.memory.free = memMatch[3]; }
            } catch {}
            try { snapshot.uptime = await sshExecutor("uptime"); } catch { snapshot.uptime = "Unknown"; }
            let savedPath = "";
            if (args.name) {
              const filename = `/tmp/snapshot-${args.name}-${Date.now()}.json`;
              try {
                const escapedJson = JSON.stringify(snapshot, null, 2).replace(/'/g, "'\"'\"'");
                await sshExecutor(`echo '${escapedJson}' > ${filename}`);
                savedPath = filename;
              } catch {}
            }
            return { content: [{ type: "text", text: applyFiltersToText(`=== Snapshot ===\n\n${savedPath ? `Saved: ${savedPath}\n\n` : ""}${JSON.stringify(snapshot, null, 2)}`, args) }] };
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
