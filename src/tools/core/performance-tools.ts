import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const performanceActions = ["bottleneck", "bandwidth", "track_metric"] as const;

export function registerPerformanceTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "performance",
    "Performance ops.",
    {
      action: z.enum(performanceActions).describe("Action"),
      metric: z.enum(["cpu", "memory", "disk"]).optional().describe("Metric type"),
      durationSeconds: z.number().int().positive().optional().default(30).describe("Duration"),
      intervalSeconds: z.number().int().positive().optional().default(5).describe("Interval"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "bottleneck": {
            const cmd = `top -b -n 2 -d 1 | grep "Cpu(s)" | tail -1 && if command -v iostat >/dev/null 2>&1; then iostat -x 1 2 | tail -n +4 | awk 'NF'; else echo "iostat not available"; fi && cat /proc/net/dev && uptime && free -m && ps aux --sort=-%cpu | head -15`;
            const output = await sshExecutor(cmd);
            const lines = output.split("\n");
            let analysis = "Bottleneck Analysis:\n\n=== RAW METRICS ===\n\n" + output + "\n\n=== ANALYSIS ===\n\n";
            let bottleneck = "None detected";
            const suggestions: string[] = [];
            const cpuLine = lines.find(l => l.includes("Cpu(s)") || l.includes("%Cpu"));
            if (cpuLine) {
              const waMatch = cpuLine.match(/(\d+\.?\d*)%?\s*wa/);
              const idMatch = cpuLine.match(/(\d+\.?\d*)%?\s*id/);
              if (waMatch && parseFloat(waMatch[1]) > 10) {
                bottleneck = "Disk I/O";
                suggestions.push("High I/O wait - check disk health, optimize I/O patterns");
              } else if (idMatch && parseFloat(idMatch[1]) < 20) {
                bottleneck = "CPU";
                suggestions.push("High CPU - identify intensive processes, optimize code");
              }
            }
            analysis += `Primary Bottleneck: ${bottleneck}\n`;
            if (suggestions.length) analysis += "\nSuggestions:\n" + suggestions.join("\n");
            else analysis += "\nSystem performing normally.";
            return { content: [{ type: "text", text: applyFiltersToText(analysis, args) }] };
          }

          case "bandwidth": {
            const cmd = `docker stats --no-stream --format "table {{.Container}}\\t{{.Name}}\\t{{.NetIO}}" 2>/dev/null || echo "Docker not available"; echo ""; echo "=== Network Interfaces ==="; cat /proc/net/dev`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Network Bandwidth:\n\n${output}`, args) }] };
          }

          case "track_metric": {
            if (!args.metric) return { content: [{ type: "text", text: "Error: metric required" }], isError: true };
            const duration = args.durationSeconds ?? 30;
            const interval = args.intervalSeconds ?? 5;
            const samples = Math.floor(duration / interval);
            let cmd = "";
            if (args.metric === "cpu") {
              cmd = `for i in $(seq 1 ${samples}); do timestamp=$(date '+%Y-%m-%d %H:%M:%S'); cpu=$(top -b -n 1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1); echo "$timestamp,$cpu"; [ $i -lt ${samples} ] && sleep ${interval}; done`;
            } else if (args.metric === "memory") {
              cmd = `for i in $(seq 1 ${samples}); do timestamp=$(date '+%Y-%m-%d %H:%M:%S'); mem=$(free -m | awk 'NR==2{printf "%.2f", $3*100/$2}'); echo "$timestamp,$mem"; [ $i -lt ${samples} ] && sleep ${interval}; done`;
            } else {
              cmd = `for i in $(seq 1 ${samples}); do timestamp=$(date '+%Y-%m-%d %H:%M:%S'); disk=$(df -h / | awk 'NR==2{print $5}' | cut -d'%' -f1); echo "$timestamp,$disk"; [ $i -lt ${samples} ] && sleep ${interval}; done`;
            }
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Metric: ${args.metric}\nDuration: ${duration}s, Interval: ${interval}s\n\nTimestamp,Value\n${output}`, args) }] };
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
