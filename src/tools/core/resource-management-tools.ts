import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const resourceActions = ["dangling", "hogs", "disk_analyzer", "docker_df", "zombies", "io_profile"] as const;

export function registerResourceManagementTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "resource",
    "Resource ops.",
    {
      action: z.enum(resourceActions).describe("Action"),
      sortBy: z.enum(["cpu", "memory", "io"]).optional().default("cpu").describe("Sort by"),
      limit: z.number().optional().default(10).describe("Limit"),
      path: z.string().optional().default("/mnt/user").describe("Path"),
      depth: z.number().optional().default(2).describe("Depth"),
      minSize: z.string().optional().default("1G").describe("Min size"),
      duration: z.number().optional().default(5).describe("Duration (s)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "dangling": {
            const volumesOutput = await sshExecutor("docker volume ls -f dangling=true --format json");
            const imagesOutput = await sshExecutor("docker images -f dangling=true --format json");
            const networksOutput = await sshExecutor("docker network ls --format json");
            const volumeLines = volumesOutput.trim().split("\n").filter(l => l.trim());
            const volumes = volumeLines.length > 0 && volumeLines[0] ? volumeLines.map(l => JSON.parse(l)) : [];
            const imageLines = imagesOutput.trim().split("\n").filter(l => l.trim());
            const images = imageLines.length > 0 && imageLines[0] ? imageLines.map(l => JSON.parse(l)) : [];
            const networkLines = networksOutput.trim().split("\n").filter(l => l.trim());
            const allNetworks = networkLines.map(l => JSON.parse(l));
            const unusedNetworks: any[] = [];
            for (const net of allNetworks) {
              if (!["bridge", "host", "none"].includes(net.Name)) {
                try {
                  const inspect = await sshExecutor(`docker network inspect ${net.Name} --format json`);
                  const data = JSON.parse(inspect);
                  if (data[0] && Object.keys(data[0].Containers || {}).length === 0) unusedNetworks.push(net);
                } catch {}
              }
            }
            let report = `DANGLING RESOURCES\n${"=".repeat(50)}\n\n`;
            report += `VOLUMES (${volumes.length}):\n${"-".repeat(50)}\n`;
            if (volumes.length === 0) report += "None.\n";
            else volumes.forEach(v => { report += `Name: ${v.Name}\nDriver: ${v.Driver}\n\n`; });
            report += `\nUNUSED NETWORKS (${unusedNetworks.length}):\n${"-".repeat(50)}\n`;
            if (unusedNetworks.length === 0) report += "None.\n";
            else unusedNetworks.forEach(n => { report += `Name: ${n.Name}\nDriver: ${n.Driver}\n\n`; });
            report += `\nDANGLING IMAGES (${images.length}):\n${"-".repeat(50)}\n`;
            if (images.length === 0) report += "None.\n";
            else images.forEach(i => { report += `ID: ${i.ID}\nCreated: ${i.CreatedSince}\n\n`; });
            report += `\nSUMMARY: ${volumes.length + unusedNetworks.length + images.length} dangling resources`;
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
          }

          case "hogs": {
            const sortBy = args.sortBy || "cpu";
            const limit = args.limit || 10;
            let report = `TOP ${limit} (by ${sortBy.toUpperCase()})\n${"=".repeat(70)}\n\n`;
            if (sortBy === "cpu") {
              const ps = await sshExecutor(`ps aux --sort=-%cpu | head -n ${limit + 1}`);
              report += `PROCESSES:\n${"-".repeat(70)}\n${ps}\n\n`;
            } else if (sortBy === "memory") {
              const ps = await sshExecutor(`ps aux --sort=-%mem | head -n ${limit + 1}`);
              report += `PROCESSES:\n${"-".repeat(70)}\n${ps}\n\n`;
            } else {
              try {
                const io = await sshExecutor("iostat -x 1 2 | tail -n +4");
                report += `I/O:\n${"-".repeat(70)}\n${io}\n\n`;
              } catch { report += "I/O: iostat not available\n\n"; }
            }
            try {
              const docker = await sshExecutor(`docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemPerc}}\\t{{.MemUsage}}'`);
              report += `CONTAINERS:\n${"-".repeat(70)}\n${docker}`;
            } catch { report += "CONTAINERS: Unable to retrieve\n"; }
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
          }

          case "disk_analyzer": {
            const path = args.path || "/mnt/user";
            const depth = args.depth || 2;
            const minSize = args.minSize || "1G";
            let report = `DISK ANALYSIS: ${path}\n${"=".repeat(70)}\n\n`;
            const du = await sshExecutor(`du -h "${path}" --max-depth=${depth} 2>/dev/null | sort -hr | head -20`);
            report += `LARGEST DIRS (depth ${depth}):\n${"-".repeat(70)}\n${du}\n\n`;
            try {
              const find = await sshExecutor(`find "${path}" -type f -size +${minSize} -exec ls -lh {} \\; 2>/dev/null | awk '{print $5 "\\t" $9}' | sort -hr | head -20`);
              report += `LARGEST FILES (>${minSize}):\n${"-".repeat(70)}\n${find.trim() ? "SIZE\tPATH\n" + find : "None found."}\n\n`;
            } catch { report += "LARGEST FILES: Unable to search\n\n"; }
            try {
              const df = await sshExecutor(`df -h "${path}"`);
              report += `FILESYSTEM:\n${"-".repeat(70)}\n${df}`;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
          }

          case "docker_df": {
            const output = await sshExecutor("docker system df -v");
            let report = `DOCKER DISK USAGE\n${"=".repeat(70)}\n\n${output}`;
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
          }

          case "zombies": {
            let report = `ZOMBIE PROCESSES\n${"=".repeat(70)}\n\n`;
            const zombies = await sshExecutor("ps aux | awk '$8==\"Z\" || $8~/^Z/ {print}'");
            report += `ZOMBIES (state Z):\n${"-".repeat(70)}\n`;
            if (zombies.trim()) {
              report += "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n" + zombies + "\n";
            } else { report += "None.\n"; }
            report += `\nD-STATE (uninterruptible sleep):\n${"-".repeat(70)}\n`;
            try {
              const dState = await sshExecutor("ps aux | awk '$8==\"D\" || $8~/^D/ {print}'");
              if (dState.trim()) report += dState;
              else report += "None.\n";
            } catch { report += "Unable to check.\n"; }
            try {
              const uptime = await sshExecutor("uptime");
              report += `\nLOAD:\n${"-".repeat(70)}\n${uptime}`;
            } catch {}
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
          }

          case "io_profile": {
            const duration = args.duration || 5;
            let report = `I/O PROFILE (${duration}s)\n${"=".repeat(70)}\n\n`;
            const stats = await sshExecutor(`timeout ${duration + 1} docker stats --no-stream --format 'table {{.Name}}\\t{{.BlockIO}}\\t{{.NetIO}}\\t{{.CPUPerc}}\\t{{.MemPerc}}'`);
            report += `CONTAINER I/O:\n${"-".repeat(70)}\n${stats}\n\n`;
            try {
              const iostat = await sshExecutor("iostat -x 1 2 | tail -n +4");
              report += `SYSTEM I/O:\n${"-".repeat(70)}\n${iostat}`;
            } catch { report += "SYSTEM I/O: iostat not available\n"; }
            return { content: [{ type: "text", text: applyFiltersToText(report, args) }] };
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
