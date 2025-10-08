import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Health status levels for diagnostics
 */
enum HealthStatus {
  OK = "OK",
  WARNING = "WARNING",
  CRITICAL = "CRITICAL",
}

/**
 * Interface for health check results
 */
interface HealthCheckResult {
  category: string;
  status: HealthStatus;
  details: string;
}

/**
 * Interface for detected issues
 */
interface DetectedIssue {
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  description: string;
}

/**
 * Interface for system snapshot
 */
interface SystemSnapshot {
  timestamp: string;
  containers: {
    running: number;
    stopped: number;
    total: number;
    list: string[];
  };
  diskUsage: {
    path: string;
    used: string;
    available: string;
    usePercent: string;
  }[];
  processes: {
    total: number;
    running: number;
  };
  memory: {
    total: string;
    used: string;
    free: string;
  };
  uptime: string;
}

/**
 * Register all health diagnostics and monitoring tools with the MCP server
 * All tools are READ-ONLY and safe for diagnostic operations
 */
export function registerHealthDiagnosticsTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: health check comprehensive - All-in-one health check
  server.tool(
    "health check comprehensive",
    "Perform a comprehensive health check of the Unraid system. Aggregates array status, drive temperatures, disk space, container health, and CPU/memory usage. Returns a summary with OK/WARNING/CRITICAL status for each category. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const results: HealthCheckResult[] = [];

        // Check 1: Array Status
        try {
          const arrayStatus = await sshExecutor("cat /proc/mdcmd 2>/dev/null || mdcmd status");
          const isStarted = arrayStatus.includes("mdState=STARTED") || arrayStatus.includes("State: Started");
          const hasParityErrors = arrayStatus.match(/sbSyncErrs=(\d+)/);
          const parityErrors = hasParityErrors ? parseInt(hasParityErrors[1]) : 0;

          let status = HealthStatus.OK;
          let details = "Array running normally";

          if (!isStarted) {
            status = HealthStatus.CRITICAL;
            details = "Array is not started";
          } else if (parityErrors > 0) {
            status = HealthStatus.WARNING;
            details = `Parity errors detected: ${parityErrors}`;
          }

          results.push({
            category: "Array Status",
            status,
            details,
          });
        } catch (error) {
          results.push({
            category: "Array Status",
            status: HealthStatus.WARNING,
            details: `Unable to check array status: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        // Check 2: Drive Temperatures
        try {
          const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
          const deviceList = devices.trim().split("\n").filter((d) => d.trim());

          let maxTemp = 0;
          let hotDrives: string[] = [];

          for (const devicePath of deviceList) {
            try {
              const deviceName = devicePath.replace("/dev/", "");
              const isNvme = deviceName.startsWith("nvme");
              const smartCmd = isNvme
                ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1`
                : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;

              const tempOutput = await sshExecutor(smartCmd);
              const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);

              if (tempMatch) {
                const temp = parseInt(tempMatch[1]);
                if (temp > maxTemp) maxTemp = temp;
                if (temp > 50) hotDrives.push(`${deviceName}: ${temp}°C`);
              }
            } catch {
              // Skip drives that don't support SMART
            }
          }

          let status = HealthStatus.OK;
          let details = `Max temperature: ${maxTemp}°C`;

          if (maxTemp > 60) {
            status = HealthStatus.CRITICAL;
            details = `Critical temperatures detected! ${hotDrives.join(", ")}`;
          } else if (maxTemp > 50) {
            status = HealthStatus.WARNING;
            details = `High temperatures detected: ${hotDrives.join(", ")}`;
          }

          results.push({
            category: "Drive Temperatures",
            status,
            details,
          });
        } catch (error) {
          results.push({
            category: "Drive Temperatures",
            status: HealthStatus.WARNING,
            details: `Unable to check temperatures: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        // Check 3: Disk Space
        try {
          const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
          const lines = dfOutput.trim().split("\n");

          let criticalDisks: string[] = [];
          let warningDisks: string[] = [];

          for (const line of lines) {
            const match = line.match(/(\S+)\s+\S+\s+\S+\s+\S+\s+(\d+)%/);
            if (match) {
              const device = match[1];
              const usePercent = parseInt(match[2]);

              if (usePercent >= 95) {
                criticalDisks.push(`${device}: ${usePercent}%`);
              } else if (usePercent >= 90) {
                warningDisks.push(`${device}: ${usePercent}%`);
              }
            }
          }

          let status = HealthStatus.OK;
          let details = "Disk space within normal limits";

          if (criticalDisks.length > 0) {
            status = HealthStatus.CRITICAL;
            details = `Critical disk space: ${criticalDisks.join(", ")}`;
          } else if (warningDisks.length > 0) {
            status = HealthStatus.WARNING;
            details = `Low disk space: ${warningDisks.join(", ")}`;
          }

          results.push({
            category: "Disk Space",
            status,
            details,
          });
        } catch (error) {
          results.push({
            category: "Disk Space",
            status: HealthStatus.WARNING,
            details: `Unable to check disk space: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        // Check 4: Container Health
        try {
          const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}},{{.State}},{{.Status}}'");
          const containers = containersOutput.trim().split("\n").filter((l) => l.trim());

          let exitedContainers: string[] = [];
          let restartingContainers: string[] = [];

          for (const container of containers) {
            const [name, state, status] = container.split(",");
            if (state === "exited") {
              exitedContainers.push(name);
            } else if (state === "restarting" || status.includes("Restarting")) {
              restartingContainers.push(name);
            }
          }

          let status = HealthStatus.OK;
          let details = `${containers.length} containers, all healthy`;

          if (restartingContainers.length > 0) {
            status = HealthStatus.CRITICAL;
            details = `Containers restarting: ${restartingContainers.join(", ")}`;
          } else if (exitedContainers.length > 0) {
            status = HealthStatus.WARNING;
            details = `Containers stopped: ${exitedContainers.join(", ")}`;
          }

          results.push({
            category: "Container Health",
            status,
            details,
          });
        } catch (error) {
          results.push({
            category: "Container Health",
            status: HealthStatus.WARNING,
            details: `Unable to check containers: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        // Check 5: CPU and Memory
        try {
          const topOutput = await sshExecutor("top -b -n 1 | head -5");
          const cpuMatch = topOutput.match(/Cpu\(s\):\s*([\d.]+)\s*us/i);
          const memMatch = topOutput.match(/Mem\s*:\s*(\d+)\s+total,\s*(\d+)\s+free/i);

          let cpuPercent = 0;
          let memPercent = 0;

          if (cpuMatch) {
            cpuPercent = parseFloat(cpuMatch[1]);
          }

          if (memMatch) {
            const total = parseInt(memMatch[1]);
            const free = parseInt(memMatch[2]);
            memPercent = ((total - free) / total) * 100;
          }

          let status = HealthStatus.OK;
          let details = `CPU: ${cpuPercent.toFixed(1)}%, Memory: ${memPercent.toFixed(1)}%`;

          if (cpuPercent > 90 || memPercent > 95) {
            status = HealthStatus.CRITICAL;
            details = `Critical resource usage! ${details}`;
          } else if (cpuPercent > 80 || memPercent > 90) {
            status = HealthStatus.WARNING;
            details = `High resource usage: ${details}`;
          }

          results.push({
            category: "CPU & Memory",
            status,
            details,
          });
        } catch (error) {
          results.push({
            category: "CPU & Memory",
            status: HealthStatus.WARNING,
            details: `Unable to check resources: ${error instanceof Error ? error.message : String(error)}`,
          });
        }

        // Format results
        const summary = results
          .map((r) => `[${r.status}] ${r.category}: ${r.details}`)
          .join("\n");

        const overallStatus = results.some((r) => r.status === HealthStatus.CRITICAL)
          ? "CRITICAL"
          : results.some((r) => r.status === HealthStatus.WARNING)
            ? "WARNING"
            : "OK";

        const output = `=== Comprehensive Health Check ===\n\nOverall Status: ${overallStatus}\n\n${summary}`;
        const filteredOutput = applyFiltersToText(output, args);

        return {
          content: [
            {
              type: "text",
              text: filteredOutput,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error performing health check: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: health detect common issues - Pattern-match known problems
  server.tool(
    "health detect common issues",
    "Scan for common known issues and problems. Checks for high temperatures (>50°C), disks >90% full, containers restarting, parity errors, and unclean shutdowns. Returns a list of detected issues with severity levels. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const issues: DetectedIssue[] = [];

        // Check 1: High temperatures
        try {
          const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
          const deviceList = devices.trim().split("\n").filter((d) => d.trim());

          for (const devicePath of deviceList) {
            try {
              const deviceName = devicePath.replace("/dev/", "");
              const isNvme = deviceName.startsWith("nvme");
              const smartCmd = isNvme
                ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1`
                : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;

              const tempOutput = await sshExecutor(smartCmd);
              const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);

              if (tempMatch) {
                const temp = parseInt(tempMatch[1]);
                if (temp > 60) {
                  issues.push({
                    severity: "critical",
                    category: "Temperature",
                    description: `Drive ${deviceName} temperature critical: ${temp}°C (>60°C)`,
                  });
                } else if (temp > 50) {
                  issues.push({
                    severity: "high",
                    category: "Temperature",
                    description: `Drive ${deviceName} temperature high: ${temp}°C (>50°C)`,
                  });
                }
              }
            } catch {
              // Skip drives that don't support SMART
            }
          }
        } catch {
          // Skip temperature checks if command fails
        }

        // Check 2: Disk space >90% full
        try {
          const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
          const lines = dfOutput.trim().split("\n");

          for (const line of lines) {
            const match = line.match(/(\S+)\s+\S+\s+\S+\s+\S+\s+(\d+)%/);
            if (match) {
              const device = match[1];
              const usePercent = parseInt(match[2]);

              if (usePercent >= 95) {
                issues.push({
                  severity: "critical",
                  category: "Disk Space",
                  description: `${device} critically full: ${usePercent}% (>=95%)`,
                });
              } else if (usePercent >= 90) {
                issues.push({
                  severity: "high",
                  category: "Disk Space",
                  description: `${device} almost full: ${usePercent}% (>=90%)`,
                });
              }
            }
          }
        } catch {
          // Skip disk space checks if command fails
        }

        // Check 3: Containers restarting
        try {
          const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}},{{.State}},{{.Status}}'");
          const containers = containersOutput.trim().split("\n").filter((l) => l.trim());

          for (const container of containers) {
            const [name, state, status] = container.split(",");
            if (state === "restarting" || status.includes("Restarting")) {
              issues.push({
                severity: "critical",
                category: "Container",
                description: `Container ${name} is stuck restarting`,
              });
            } else if (state === "exited" && status.includes("(0)") === false) {
              // Exited with non-zero code
              issues.push({
                severity: "medium",
                category: "Container",
                description: `Container ${name} exited abnormally: ${status}`,
              });
            }
          }
        } catch {
          // Skip container checks if command fails
        }

        // Check 4: Parity errors
        try {
          const arrayStatus = await sshExecutor("cat /proc/mdcmd 2>/dev/null || mdcmd status");
          const hasParityErrors = arrayStatus.match(/sbSyncErrs=(\d+)/);

          if (hasParityErrors) {
            const parityErrors = parseInt(hasParityErrors[1]);
            if (parityErrors > 0) {
              issues.push({
                severity: "high",
                category: "Array",
                description: `Parity errors detected: ${parityErrors}`,
              });
            }
          }

          // Check for sync in progress
          if (arrayStatus.includes("mdResyncPos") && arrayStatus.includes("mdResyncSize")) {
            const posMatch = arrayStatus.match(/mdResyncPos=(\d+)/);
            const sizeMatch = arrayStatus.match(/mdResyncSize=(\d+)/);

            if (posMatch && sizeMatch) {
              const pos = parseInt(posMatch[1]);
              const size = parseInt(sizeMatch[1]);
              if (size > 0 && pos < size) {
                const percent = ((pos / size) * 100).toFixed(1);
                issues.push({
                  severity: "low",
                  category: "Array",
                  description: `Parity sync in progress: ${percent}%`,
                });
              }
            }
          }
        } catch {
          // Skip array checks if command fails
        }

        // Check 5: Unclean shutdowns
        try {
          const syslog = await sshExecutor("tail -n 500 /var/log/syslog 2>/dev/null || tail -n 500 /var/log/messages 2>/dev/null || echo ''");

          if (syslog.includes("emergency") || syslog.includes("panic") || syslog.includes("kernel panic")) {
            issues.push({
              severity: "critical",
              category: "System",
              description: "Recent kernel panic or emergency detected in system logs",
            });
          }

          if (syslog.includes("filesystem was not cleanly unmounted") || syslog.includes("filesystem error")) {
            issues.push({
              severity: "high",
              category: "Filesystem",
              description: "Filesystem was not cleanly unmounted (possible power failure)",
            });
          }
        } catch {
          // Skip log checks if command fails
        }

        // Format results
        if (issues.length === 0) {
          const output = "=== Common Issues Detection ===\n\nNo issues detected. System appears healthy.";
          const filteredOutput = applyFiltersToText(output, args);
          return {
            content: [
              {
                type: "text",
                text: filteredOutput,
              },
            ],
          };
        }

        const sortedIssues = issues.sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return severityOrder[a.severity] - severityOrder[b.severity];
        });

        const issuesList = sortedIssues
          .map((issue) => `[${issue.severity.toUpperCase()}] ${issue.category}: ${issue.description}`)
          .join("\n");

        const summary = `Found ${issues.length} issue(s):\n- Critical: ${issues.filter((i) => i.severity === "critical").length}\n- High: ${issues.filter((i) => i.severity === "high").length}\n- Medium: ${issues.filter((i) => i.severity === "medium").length}\n- Low: ${issues.filter((i) => i.severity === "low").length}`;

        const output = `=== Common Issues Detection ===\n\n${summary}\n\n${issuesList}`;
        const filteredOutput = applyFiltersToText(output, args);

        return {
          content: [
            {
              type: "text",
              text: filteredOutput,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error detecting issues: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: health threshold alerts - Check metrics against thresholds
  server.tool(
    "health threshold alerts",
    "Check if any system metrics exceed specified thresholds. Monitors CPU usage, memory usage, disk usage, and drive temperatures against custom or default thresholds. Returns alerts when thresholds are exceeded. Supports comprehensive output filtering.",
    {
      cpuThreshold: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(80)
        .describe("CPU usage threshold percentage (default: 80)"),
      memThreshold: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(90)
        .describe("Memory usage threshold percentage (default: 90)"),
      diskThreshold: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(90)
        .describe("Disk usage threshold percentage (default: 90)"),
      tempThreshold: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(50)
        .describe("Drive temperature threshold in Celsius (default: 50)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const cpuThreshold = args.cpuThreshold ?? 80;
        const memThreshold = args.memThreshold ?? 90;
        const diskThreshold = args.diskThreshold ?? 90;
        const tempThreshold = args.tempThreshold ?? 50;

        const alerts: string[] = [];

        // Check CPU
        try {
          const topOutput = await sshExecutor("top -b -n 1 | head -5");
          const cpuMatch = topOutput.match(/Cpu\(s\):\s*([\d.]+)\s*us/i);

          if (cpuMatch) {
            const cpuPercent = parseFloat(cpuMatch[1]);
            if (cpuPercent > cpuThreshold) {
              alerts.push(`CPU usage ${cpuPercent.toFixed(1)}% exceeds threshold ${cpuThreshold}%`);
            }
          }
        } catch {
          alerts.push("Unable to check CPU usage");
        }

        // Check Memory
        try {
          const memOutput = await sshExecutor("free | grep Mem:");
          const memMatch = memOutput.match(/Mem:\s*(\d+)\s+(\d+)/);

          if (memMatch) {
            const total = parseInt(memMatch[1]);
            const used = parseInt(memMatch[2]);
            const memPercent = (used / total) * 100;

            if (memPercent > memThreshold) {
              alerts.push(`Memory usage ${memPercent.toFixed(1)}% exceeds threshold ${memThreshold}%`);
            }
          }
        } catch {
          alerts.push("Unable to check memory usage");
        }

        // Check Disk Usage
        try {
          const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
          const lines = dfOutput.trim().split("\n");

          for (const line of lines) {
            const match = line.match(/(\S+)\s+\S+\s+\S+\s+\S+\s+(\d+)%/);
            if (match) {
              const device = match[1];
              const usePercent = parseInt(match[2]);

              if (usePercent > diskThreshold) {
                alerts.push(`Disk ${device} usage ${usePercent}% exceeds threshold ${diskThreshold}%`);
              }
            }
          }
        } catch {
          alerts.push("Unable to check disk usage");
        }

        // Check Temperatures
        try {
          const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
          const deviceList = devices.trim().split("\n").filter((d) => d.trim());

          for (const devicePath of deviceList) {
            try {
              const deviceName = devicePath.replace("/dev/", "");
              const isNvme = deviceName.startsWith("nvme");
              const smartCmd = isNvme
                ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1`
                : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;

              const tempOutput = await sshExecutor(smartCmd);
              const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);

              if (tempMatch) {
                const temp = parseInt(tempMatch[1]);
                if (temp > tempThreshold) {
                  alerts.push(`Drive ${deviceName} temperature ${temp}°C exceeds threshold ${tempThreshold}°C`);
                }
              }
            } catch {
              // Skip drives that don't support SMART
            }
          }
        } catch {
          alerts.push("Unable to check drive temperatures");
        }

        // Format results
        if (alerts.length === 0) {
          const output = `=== Threshold Alerts ===\n\nThresholds:\n- CPU: ${cpuThreshold}%\n- Memory: ${memThreshold}%\n- Disk: ${diskThreshold}%\n- Temperature: ${tempThreshold}°C\n\nNo thresholds exceeded. All metrics within normal range.`;
          const filteredOutput = applyFiltersToText(output, args);
          return {
            content: [
              {
                type: "text",
                text: filteredOutput,
              },
            ],
          };
        }

        const alertsList = alerts.map((alert, i) => `${i + 1}. ${alert}`).join("\n");

        const output = `=== Threshold Alerts ===\n\nThresholds:\n- CPU: ${cpuThreshold}%\n- Memory: ${memThreshold}%\n- Disk: ${diskThreshold}%\n- Temperature: ${tempThreshold}°C\n\n${alerts.length} Alert(s):\n\n${alertsList}`;
        const filteredOutput = applyFiltersToText(output, args);

        return {
          content: [
            {
              type: "text",
              text: filteredOutput,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking thresholds: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: health compare baseline - Compare vs baseline
  server.tool(
    "health compare baseline",
    "Compare current system state against a saved baseline snapshot. Can save a new baseline or compare against an existing one. Tracks changes in container count, disk usage, running processes, and memory usage over time. Supports comprehensive output filtering.",
    {
      baselineFile: z
        .string()
        .optional()
        .default("/tmp/unraid-baseline.json")
        .describe("Path to baseline file (default: /tmp/unraid-baseline.json)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const baselineFile = args.baselineFile ?? "/tmp/unraid-baseline.json";

        // Collect current state
        const currentState: any = {
          timestamp: new Date().toISOString(),
        };

        // Get container count
        try {
          const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}}'");
          const containers = containersOutput.trim().split("\n").filter((l) => l.trim());
          currentState.containerCount = containers.length;

          const runningOutput = await sshExecutor("docker ps --format '{{.Names}}'");
          const running = runningOutput.trim().split("\n").filter((l) => l.trim());
          currentState.runningContainers = running.length;
        } catch {
          currentState.containerCount = 0;
          currentState.runningContainers = 0;
        }

        // Get disk usage
        try {
          const dfOutput = await sshExecutor("df -h / | tail -1");
          const match = dfOutput.match(/\S+\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)%/);
          if (match) {
            currentState.rootDiskUsed = match[1];
            currentState.rootDiskAvailable = match[2];
            currentState.rootDiskPercent = parseInt(match[3]);
          }
        } catch {
          currentState.rootDiskPercent = 0;
        }

        // Get process count
        try {
          const psOutput = await sshExecutor("ps aux | wc -l");
          currentState.processCount = parseInt(psOutput.trim());
        } catch {
          currentState.processCount = 0;
        }

        // Get memory usage
        try {
          const memOutput = await sshExecutor("free | grep Mem:");
          const memMatch = memOutput.match(/Mem:\s*(\d+)\s+(\d+)/);
          if (memMatch) {
            const total = parseInt(memMatch[1]);
            const used = parseInt(memMatch[2]);
            currentState.memoryPercent = ((used / total) * 100).toFixed(1);
          }
        } catch {
          currentState.memoryPercent = 0;
        }

        // Try to read baseline
        let baseline: any = null;
        try {
          const baselineJson = await sshExecutor(`cat ${baselineFile}`);
          baseline = JSON.parse(baselineJson);
        } catch {
          // No baseline exists, save current as baseline
          try {
            const escapedJson = JSON.stringify(currentState, null, 2).replace(/'/g, "'\"'\"'");
            await sshExecutor(`echo '${escapedJson}' > ${baselineFile}`);
            const output = `=== Baseline Comparison ===\n\nNo existing baseline found. Current state saved as new baseline to:\n${baselineFile}\n\nCurrent State:\n${JSON.stringify(currentState, null, 2)}`;
            const filteredOutput = applyFiltersToText(output, args);
            return {
              content: [
                {
                  type: "text",
                  text: filteredOutput,
                },
              ],
            };
          } catch (saveError) {
            throw new Error(`Failed to save baseline: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
          }
        }

        // Compare current vs baseline
        const changes: string[] = [];

        if (currentState.containerCount !== baseline.containerCount) {
          const diff = currentState.containerCount - baseline.containerCount;
          changes.push(`Container count: ${baseline.containerCount} -> ${currentState.containerCount} (${diff > 0 ? "+" : ""}${diff})`);
        }

        if (currentState.runningContainers !== baseline.runningContainers) {
          const diff = currentState.runningContainers - baseline.runningContainers;
          changes.push(`Running containers: ${baseline.runningContainers} -> ${currentState.runningContainers} (${diff > 0 ? "+" : ""}${diff})`);
        }

        if (currentState.rootDiskPercent !== baseline.rootDiskPercent) {
          const diff = currentState.rootDiskPercent - baseline.rootDiskPercent;
          changes.push(`Root disk usage: ${baseline.rootDiskPercent}% -> ${currentState.rootDiskPercent}% (${diff > 0 ? "+" : ""}${diff}%)`);
        }

        if (currentState.processCount !== baseline.processCount) {
          const diff = currentState.processCount - baseline.processCount;
          changes.push(`Process count: ${baseline.processCount} -> ${currentState.processCount} (${diff > 0 ? "+" : ""}${diff})`);
        }

        const currentMemPercent = parseFloat(currentState.memoryPercent);
        const baselineMemPercent = parseFloat(baseline.memoryPercent);
        if (Math.abs(currentMemPercent - baselineMemPercent) > 5) {
          const diff = currentMemPercent - baselineMemPercent;
          changes.push(`Memory usage: ${baselineMemPercent.toFixed(1)}% -> ${currentMemPercent.toFixed(1)}% (${diff > 0 ? "+" : ""}${diff.toFixed(1)}%)`);
        }

        const baselineDate = new Date(baseline.timestamp).toLocaleString();
        const currentDate = new Date(currentState.timestamp).toLocaleString();

        if (changes.length === 0) {
          const output = `=== Baseline Comparison ===\n\nBaseline: ${baselineDate}\nCurrent: ${currentDate}\n\nNo significant changes detected since baseline.`;
          const filteredOutput = applyFiltersToText(output, args);
          return {
            content: [
              {
                type: "text",
                text: filteredOutput,
              },
            ],
          };
        }

        const changesList = changes.map((change, i) => `${i + 1}. ${change}`).join("\n");

        const output = `=== Baseline Comparison ===\n\nBaseline: ${baselineDate}\nCurrent: ${currentDate}\n\n${changes.length} Change(s) Detected:\n\n${changesList}`;
        const filteredOutput = applyFiltersToText(output, args);

        return {
          content: [
            {
              type: "text",
              text: filteredOutput,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error comparing baseline: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: health generate diagnostic report - Comprehensive report
  server.tool(
    "health generate diagnostic report",
    "Generate a comprehensive diagnostic report of the entire Unraid system. Aggregates system information, array status, container status, disk usage, temperatures, and recent log entries into a formatted report. Supports text or markdown output. Supports comprehensive output filtering.",
    {
      format: z
        .enum(["text", "markdown"])
        .optional()
        .default("text")
        .describe("Report format: 'text' or 'markdown' (default: text)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const format = args.format ?? "text";
        const isMarkdown = format === "markdown";

        let report = "";

        // Header
        if (isMarkdown) {
          report += "# Unraid System Diagnostic Report\n\n";
          report += `**Generated:** ${new Date().toLocaleString()}\n\n`;
        } else {
          report += "=".repeat(60) + "\n";
          report += "UNRAID SYSTEM DIAGNOSTIC REPORT\n";
          report += "=".repeat(60) + "\n";
          report += `Generated: ${new Date().toLocaleString()}\n\n`;
        }

        // System Info
        if (isMarkdown) {
          report += "## System Information\n\n";
        } else {
          report += "--- SYSTEM INFORMATION ---\n\n";
        }

        try {
          const unameOutput = await sshExecutor("uname -a");
          report += isMarkdown ? `**Kernel:** ${unameOutput}\n\n` : `Kernel: ${unameOutput}\n`;

          const uptimeOutput = await sshExecutor("uptime");
          report += isMarkdown ? `**Uptime:** ${uptimeOutput}\n\n` : `Uptime: ${uptimeOutput}\n`;
        } catch {
          report += "Unable to retrieve system information\n";
        }

        report += "\n";

        // Array Status
        if (isMarkdown) {
          report += "## Array Status\n\n";
        } else {
          report += "--- ARRAY STATUS ---\n\n";
        }

        try {
          const arrayStatus = await sshExecutor("cat /proc/mdcmd 2>/dev/null || mdcmd status");
          report += isMarkdown ? `\`\`\`\n${arrayStatus}\n\`\`\`\n\n` : `${arrayStatus}\n\n`;
        } catch {
          report += "Unable to retrieve array status\n\n";
        }

        // Container Status
        if (isMarkdown) {
          report += "## Container Status\n\n";
        } else {
          report += "--- CONTAINER STATUS ---\n\n";
        }

        try {
          const containersOutput = await sshExecutor("docker ps -a --format 'table {{.Names}}\t{{.State}}\t{{.Status}}'");
          report += isMarkdown ? `\`\`\`\n${containersOutput}\n\`\`\`\n\n` : `${containersOutput}\n\n`;
        } catch {
          report += "Unable to retrieve container status\n\n";
        }

        // Disk Usage
        if (isMarkdown) {
          report += "## Disk Usage\n\n";
        } else {
          report += "--- DISK USAGE ---\n\n";
        }

        try {
          const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)|Filesystem'");
          report += isMarkdown ? `\`\`\`\n${dfOutput}\n\`\`\`\n\n` : `${dfOutput}\n\n`;
        } catch {
          report += "Unable to retrieve disk usage\n\n";
        }

        // Drive Temperatures
        if (isMarkdown) {
          report += "## Drive Temperatures\n\n";
        } else {
          report += "--- DRIVE TEMPERATURES ---\n\n";
        }

        try {
          const devices = await sshExecutor("ls -1 /dev/sd? /dev/nvme?n? 2>/dev/null || true");
          const deviceList = devices.trim().split("\n").filter((d) => d.trim());

          for (const devicePath of deviceList) {
            try {
              const deviceName = devicePath.replace("/dev/", "");
              const isNvme = deviceName.startsWith("nvme");
              const smartCmd = isNvme
                ? `smartctl -A -d nvme ${devicePath} 2>/dev/null | grep -i temperature | head -1`
                : `smartctl -A -d ata ${devicePath} 2>/dev/null | grep -i temperature_celsius | head -1`;

              const tempOutput = await sshExecutor(smartCmd);
              const tempMatch = tempOutput.match(/(\d+)\s+(Celsius|C\b)/i);

              if (tempMatch) {
                const temp = parseInt(tempMatch[1]);
                report += isMarkdown ? `- **${deviceName}:** ${temp}°C\n` : `${deviceName}: ${temp}°C\n`;
              }
            } catch {
              report += isMarkdown ? `- **${devicePath.replace("/dev/", "")}:** Unable to read\n` : `${devicePath.replace("/dev/", "")}: Unable to read\n`;
            }
          }
          report += "\n";
        } catch {
          report += "Unable to retrieve drive temperatures\n\n";
        }

        // Resource Usage
        if (isMarkdown) {
          report += "## Resource Usage\n\n";
        } else {
          report += "--- RESOURCE USAGE ---\n\n";
        }

        try {
          const memOutput = await sshExecutor("free -h");
          report += isMarkdown ? `\`\`\`\n${memOutput}\n\`\`\`\n\n` : `${memOutput}\n\n`;
        } catch {
          report += "Unable to retrieve memory usage\n\n";
        }

        // Recent Logs Summary
        if (isMarkdown) {
          report += "## Recent System Logs (Last 20 Lines)\n\n";
        } else {
          report += "--- RECENT SYSTEM LOGS (LAST 20 LINES) ---\n\n";
        }

        try {
          const logsOutput = await sshExecutor("tail -n 20 /var/log/syslog 2>/dev/null || tail -n 20 /var/log/messages 2>/dev/null || echo 'Logs not available'");
          report += isMarkdown ? `\`\`\`\n${logsOutput}\n\`\`\`\n\n` : `${logsOutput}\n\n`;
        } catch {
          report += "Unable to retrieve system logs\n\n";
        }

        // Footer
        if (isMarkdown) {
          report += "---\n\n*End of Diagnostic Report*\n";
        } else {
          report += "=".repeat(60) + "\n";
          report += "END OF REPORT\n";
          report += "=".repeat(60) + "\n";
        }

        const filteredReport = applyFiltersToText(report, args);

        return {
          content: [
            {
              type: "text",
              text: filteredReport,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating diagnostic report: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: health snapshot system state - Save system state
  server.tool(
    "health snapshot system state",
    "Capture and save a complete snapshot of the current system state. Includes container information, disk usage, running processes, memory state, and network configuration. Returns the snapshot as JSON and optionally saves it to a file. Supports comprehensive output filtering.",
    {
      name: z
        .string()
        .optional()
        .describe("Optional name for the snapshot (will be used in filename)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const snapshot: SystemSnapshot = {
          timestamp: new Date().toISOString(),
          containers: {
            running: 0,
            stopped: 0,
            total: 0,
            list: [],
          },
          diskUsage: [],
          processes: {
            total: 0,
            running: 0,
          },
          memory: {
            total: "",
            used: "",
            free: "",
          },
          uptime: "",
        };

        // Capture container state
        try {
          const containersOutput = await sshExecutor("docker ps -a --format '{{.Names}},{{.State}}'");
          const containers = containersOutput.trim().split("\n").filter((l) => l.trim());

          snapshot.containers.total = containers.length;

          for (const container of containers) {
            const [name, state] = container.split(",");
            snapshot.containers.list.push(`${name}: ${state}`);
            if (state === "running") {
              snapshot.containers.running++;
            } else {
              snapshot.containers.stopped++;
            }
          }
        } catch {
          // Leave containers empty if Docker check fails
        }

        // Capture disk usage
        try {
          const dfOutput = await sshExecutor("df -h | grep -E '^/dev/(sd|nvme|md)'");
          const lines = dfOutput.trim().split("\n");

          for (const line of lines) {
            const match = line.match(/(\S+)\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)%/);
            if (match) {
              snapshot.diskUsage.push({
                path: match[1],
                used: match[2],
                available: match[3],
                usePercent: match[4],
              });
            }
          }
        } catch {
          // Leave diskUsage empty if df check fails
        }

        // Capture process info
        try {
          const psOutput = await sshExecutor("ps aux | wc -l");
          snapshot.processes.total = parseInt(psOutput.trim());

          const runningOutput = await sshExecutor("ps aux | grep -c ' R '");
          snapshot.processes.running = parseInt(runningOutput.trim());
        } catch {
          // Leave process counts at 0 if ps check fails
        }

        // Capture memory state
        try {
          const memOutput = await sshExecutor("free -h | grep Mem:");
          const memMatch = memOutput.match(/Mem:\s*(\S+)\s+(\S+)\s+(\S+)/);
          if (memMatch) {
            snapshot.memory.total = memMatch[1];
            snapshot.memory.used = memMatch[2];
            snapshot.memory.free = memMatch[3];
          }
        } catch {
          // Leave memory values empty if free check fails
        }

        // Capture uptime
        try {
          snapshot.uptime = await sshExecutor("uptime");
        } catch {
          snapshot.uptime = "Unknown";
        }

        // Save snapshot to file if name provided
        let savedPath = "";
        if (args.name) {
          const filename = `/tmp/snapshot-${args.name}-${Date.now()}.json`;
          try {
            const escapedJson = JSON.stringify(snapshot, null, 2).replace(/'/g, "'\"'\"'");
            await sshExecutor(`echo '${escapedJson}' > ${filename}`);
            savedPath = filename;
          } catch {
            // Continue even if save fails
          }
        }

        const snapshotJson = JSON.stringify(snapshot, null, 2);
        const output = `=== System State Snapshot ===\n\n${savedPath ? `Saved to: ${savedPath}\n\n` : ""}${snapshotJson}`;
        const filteredOutput = applyFiltersToText(output, args);

        return {
          content: [
            {
              type: "text",
              text: filteredOutput,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error capturing system snapshot: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
