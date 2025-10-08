import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all resource management and optimization tools with the MCP server
 */
export function registerResourceManagementTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: resource find dangling resources - Find unused Docker resources
  server.tool(
    "resource find dangling resources",
    "Find unused Docker resources including dangling volumes, unused networks, and dangling images. Shows resource names and sizes to help identify cleanup opportunities. READ-ONLY - does not perform any cleanup. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Get dangling volumes
        const volumesCommand = "docker volume ls -f dangling=true --format json";
        const volumesOutput = await sshExecutor(volumesCommand);

        // Get all volumes with size info
        const volumeSizeCommand = "docker system df -v --format json";
        const volumeSizeOutput = await sshExecutor(volumeSizeCommand);

        // Get dangling images
        const imagesCommand = "docker images -f dangling=true --format json";
        const imagesOutput = await sshExecutor(imagesCommand);

        // Get all networks
        const networksCommand = "docker network ls --format json";
        const networksOutput = await sshExecutor(networksCommand);

        // Parse volumes
        const volumeLines = volumesOutput
          .trim()
          .split("\n")
          .filter((line) => line.trim());
        const volumes = volumeLines.length > 0 && volumeLines[0]
          ? volumeLines.map((line) => JSON.parse(line))
          : [];

        // Parse volume sizes from system df
        let volumeSizes: Record<string, string> = {};
        try {
          const sizeData = JSON.parse(volumeSizeOutput);
          if (sizeData.Volumes) {
            volumeSizes = sizeData.Volumes.reduce((acc: Record<string, string>, v: any) => {
              acc[v.Name] = v.Size || "0B";
              return acc;
            }, {});
          }
        } catch {
          // Fallback if JSON parsing fails
          volumeSizes = {};
        }

        // Parse images
        const imageLines = imagesOutput
          .trim()
          .split("\n")
          .filter((line) => line.trim());
        const images = imageLines.length > 0 && imageLines[0]
          ? imageLines.map((line) => JSON.parse(line))
          : [];

        // Parse networks and filter for unused ones (not default networks and not in use)
        const networkLines = networksOutput
          .trim()
          .split("\n")
          .filter((line) => line.trim());
        const allNetworks = networkLines.map((line) => JSON.parse(line));

        // Check which networks are actually in use by inspecting them
        const unusedNetworks: any[] = [];
        for (const network of allNetworks) {
          if (
            network.Name !== "bridge" &&
            network.Name !== "host" &&
            network.Name !== "none"
          ) {
            try {
              const inspectCmd = `docker network inspect ${network.Name} --format json`;
              const inspectOut = await sshExecutor(inspectCmd);
              const inspectData = JSON.parse(inspectOut);
              if (
                inspectData[0] &&
                Object.keys(inspectData[0].Containers || {}).length === 0
              ) {
                unusedNetworks.push(network);
              }
            } catch {
              // Skip networks that can't be inspected
            }
          }
        }

        // Format output
        let report = "DANGLING DOCKER RESOURCES\n";
        report += "=".repeat(50) + "\n\n";

        // Dangling Volumes
        report += `DANGLING VOLUMES (${volumes.length}):\n`;
        report += "-".repeat(50) + "\n";
        if (volumes.length === 0) {
          report += "No dangling volumes found.\n";
        } else {
          volumes.forEach((vol) => {
            const size = volumeSizes[vol.Name] || "unknown";
            report += `Name: ${vol.Name}\n`;
            report += `Size: ${size}\n`;
            report += `Driver: ${vol.Driver}\n\n`;
          });
        }

        // Unused Networks
        report += `\nUNUSED NETWORKS (${unusedNetworks.length}):\n`;
        report += "-".repeat(50) + "\n";
        if (unusedNetworks.length === 0) {
          report += "No unused networks found.\n";
        } else {
          unusedNetworks.forEach((net) => {
            report += `Name: ${net.Name}\n`;
            report += `ID: ${net.ID}\n`;
            report += `Driver: ${net.Driver}\n`;
            report += `Scope: ${net.Scope}\n\n`;
          });
        }

        // Dangling Images
        report += `\nDANGLING IMAGES (${images.length}):\n`;
        report += "-".repeat(50) + "\n";
        if (images.length === 0) {
          report += "No dangling images found.\n";
        } else {
          images.forEach((img) => {
            const sizeGB = img.Size
              ? (parseInt(img.Size) / (1024 * 1024 * 1024)).toFixed(2)
              : "unknown";
            report += `ID: ${img.ID}\n`;
            report += `Created: ${img.CreatedSince}\n`;
            report += `Size: ${sizeGB} GB\n\n`;
          });
        }

        // Summary
        const totalDangling = volumes.length + unusedNetworks.length + images.length;
        report += `\nSUMMARY: ${totalDangling} dangling resources found\n`;
        report += `  - ${volumes.length} volumes\n`;
        report += `  - ${unusedNetworks.length} networks\n`;
        report += `  - ${images.length} images\n`;

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
              text: `Error finding dangling resources: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: resource find resource hogs - Find top resource consumers
  server.tool(
    "resource find resource hogs",
    "Identify top resource consumers on the system. Can sort by CPU, memory, or I/O usage. Analyzes both system processes and Docker containers to find what's consuming the most resources. Supports comprehensive output filtering.",
    {
      sortBy: z
        .enum(["cpu", "memory", "io"])
        .optional()
        .default("cpu")
        .describe("Sort by cpu, memory, or io (default: cpu)"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Number of top consumers to show (default: 10)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const sortBy = args.sortBy || "cpu";
        const limit = args.limit || 10;

        let report = `TOP ${limit} RESOURCE CONSUMERS (sorted by ${sortBy.toUpperCase()})\n`;
        report += "=".repeat(70) + "\n\n";

        if (sortBy === "cpu") {
          // Get top CPU consumers
          const psCommand = `ps aux --sort=-%cpu | head -n ${limit + 1}`;
          const psOutput = await sshExecutor(psCommand);

          report += "SYSTEM PROCESSES (CPU %):\n";
          report += "-".repeat(70) + "\n";
          report += psOutput + "\n\n";

          // Get Docker container CPU usage
          const dockerStatsCommand = "docker stats --no-stream --format 'table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemPerc}}\\t{{.MemUsage}}'";
          try {
            const dockerStats = await sshExecutor(dockerStatsCommand);
            report += "DOCKER CONTAINERS:\n";
            report += "-".repeat(70) + "\n";
            report += dockerStats + "\n";
          } catch {
            report += "DOCKER CONTAINERS: Unable to retrieve stats\n";
          }
        } else if (sortBy === "memory") {
          // Get top memory consumers
          const psCommand = `ps aux --sort=-%mem | head -n ${limit + 1}`;
          const psOutput = await sshExecutor(psCommand);

          report += "SYSTEM PROCESSES (MEM %):\n";
          report += "-".repeat(70) + "\n";
          report += psOutput + "\n\n";

          // Get Docker container memory usage
          const dockerStatsCommand = "docker stats --no-stream --format 'table {{.Name}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.CPUPerc}}'";
          try {
            const dockerStats = await sshExecutor(dockerStatsCommand);
            report += "DOCKER CONTAINERS:\n";
            report += "-".repeat(70) + "\n";
            report += dockerStats + "\n";
          } catch {
            report += "DOCKER CONTAINERS: Unable to retrieve stats\n";
          }
        } else if (sortBy === "io") {
          // Get I/O statistics
          report += "I/O STATISTICS:\n";
          report += "-".repeat(70) + "\n";

          // System I/O stats using iostat if available, otherwise iotop
          try {
            const iostatCommand = "iostat -x 1 2 | tail -n +4";
            const iostatOutput = await sshExecutor(iostatCommand);
            report += "DISK I/O:\n";
            report += iostatOutput + "\n\n";
          } catch {
            report += "DISK I/O: iostat not available\n\n";
          }

          // Docker container I/O
          const dockerStatsCommand = "docker stats --no-stream --format 'table {{.Name}}\\t{{.BlockIO}}\\t{{.NetIO}}'";
          try {
            const dockerStats = await sshExecutor(dockerStatsCommand);
            report += "DOCKER CONTAINERS:\n";
            report += "-".repeat(70) + "\n";
            report += dockerStats + "\n";
          } catch {
            report += "DOCKER CONTAINERS: Unable to retrieve stats\n";
          }
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
              text: `Error finding resource hogs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: resource disk space analyzer - Find largest files and directories
  server.tool(
    "resource disk space analyzer",
    "Analyze disk space usage by finding the largest files and directories. Useful for identifying what's consuming disk space. Can filter by path, depth, and minimum file size. Supports comprehensive output filtering.",
    {
      path: z
        .string()
        .optional()
        .default("/mnt/user")
        .describe("Path to analyze (default: /mnt/user)"),
      depth: z
        .number()
        .optional()
        .default(2)
        .describe("Maximum directory depth to analyze (default: 2)"),
      minSize: z
        .string()
        .optional()
        .default("1G")
        .describe("Minimum size to report (e.g., 1G, 100M) (default: 1G)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const path = args.path || "/mnt/user";
        const depth = args.depth || 2;
        const minSize = args.minSize || "1G";

        let report = `DISK SPACE ANALYSIS: ${path}\n`;
        report += "=".repeat(70) + "\n\n";

        // Get directory sizes
        const duCommand = `du -h "${path}" --max-depth=${depth} 2>/dev/null | sort -hr | head -20`;
        const duOutput = await sshExecutor(duCommand);

        report += `LARGEST DIRECTORIES (max depth ${depth}):\n`;
        report += "-".repeat(70) + "\n";
        report += duOutput + "\n\n";

        // Get largest individual files
        const findCommand = `find "${path}" -type f -size +${minSize} -exec ls -lh {} \\; 2>/dev/null | awk '{print $5 "\\t" $9}' | sort -hr | head -20`;
        try {
          const findOutput = await sshExecutor(findCommand);
          report += `LARGEST FILES (minimum ${minSize}):\n`;
          report += "-".repeat(70) + "\n";
          if (findOutput.trim()) {
            report += "SIZE\tPATH\n";
            report += findOutput + "\n";
          } else {
            report += `No files larger than ${minSize} found.\n`;
          }
        } catch {
          report += `LARGEST FILES: Unable to search (may need elevated permissions)\n`;
        }

        // Get overall filesystem usage
        report += "\nFILESYSTEM USAGE:\n";
        report += "-".repeat(70) + "\n";
        try {
          const dfCommand = `df -h "${path}"`;
          const dfOutput = await sshExecutor(dfCommand);
          report += dfOutput + "\n";
        } catch {
          report += "Unable to get filesystem usage\n";
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
              text: `Error analyzing disk space: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: resource docker system df - Docker disk usage breakdown
  server.tool(
    "resource docker system df",
    "Show detailed Docker disk usage breakdown including images, containers, volumes, and build cache. Provides comprehensive view of Docker storage consumption. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Get verbose Docker system disk usage
        const command = "docker system df -v";
        const output = await sshExecutor(command);

        let report = "DOCKER SYSTEM DISK USAGE\n";
        report += "=".repeat(70) + "\n\n";
        report += output + "\n\n";

        // Get summary statistics
        const summaryCommand = "docker system df --format json";
        try {
          const summaryOutput = await sshExecutor(summaryCommand);
          const summary = JSON.parse(summaryOutput);

          report += "SUMMARY:\n";
          report += "-".repeat(70) + "\n";

          if (summary.Images) {
            const img = summary.Images[0];
            report += `Images: ${img.TotalCount} total, ${img.Active} active\n`;
            report += `  Size: ${img.Size}, Reclaimable: ${img.Reclaimable}\n\n`;
          }

          if (summary.Containers) {
            const cont = summary.Containers[0];
            report += `Containers: ${cont.TotalCount} total, ${cont.Active} active\n`;
            report += `  Size: ${cont.Size}, Reclaimable: ${cont.Reclaimable}\n\n`;
          }

          if (summary.Volumes) {
            const vol = summary.Volumes[0];
            report += `Volumes: ${vol.TotalCount} total, ${vol.Active} active\n`;
            report += `  Size: ${vol.Size}, Reclaimable: ${vol.Reclaimable}\n\n`;
          }

          if (summary.BuildCache) {
            const cache = summary.BuildCache[0];
            report += `Build Cache:\n`;
            report += `  Size: ${cache.Size}, Reclaimable: ${cache.Reclaimable}\n`;
          }
        } catch {
          // If JSON parsing fails, just show the verbose output above
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
              text: `Error getting Docker disk usage: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: resource find zombie processes - Find zombie/stuck processes
  server.tool(
    "resource find zombie processes",
    "Find zombie (defunct) and stuck processes on the system. Zombie processes are terminated processes that haven't been properly cleaned up by their parent. Shows process ID, parent PID, and command. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let report = "ZOMBIE AND STUCK PROCESSES\n";
        report += "=".repeat(70) + "\n\n";

        // Find zombie processes (state Z)
        const zombieCommand = "ps aux | awk '$8==\"Z\" || $8~/^Z/ {print}'";
        const zombieOutput = await sshExecutor(zombieCommand);

        report += "ZOMBIE PROCESSES (state Z):\n";
        report += "-".repeat(70) + "\n";
        if (zombieOutput.trim()) {
          // Add header
          report += "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n";
          report += zombieOutput + "\n";

          // Get parent processes of zombies
          const zombiePids = zombieOutput
            .trim()
            .split("\n")
            .map((line) => line.split(/\s+/)[1]);

          if (zombiePids.length > 0) {
            report += "\nPARENT PROCESSES:\n";
            report += "-".repeat(70) + "\n";
            for (const pid of zombiePids) {
              try {
                const ppidCommand = `ps -o ppid= -p ${pid}`;
                const ppid = (await sshExecutor(ppidCommand)).trim();
                if (ppid) {
                  const parentCommand = `ps -p ${ppid} -o pid,ppid,stat,comm`;
                  const parentInfo = await sshExecutor(parentCommand);
                  report += parentInfo + "\n";
                }
              } catch {
                // Skip if unable to get parent info
              }
            }
          }
        } else {
          report += "No zombie processes found.\n";
        }

        // Find processes in D state (uninterruptible sleep - often indicates I/O issues)
        report += "\nPROCESSES IN UNINTERRUPTIBLE SLEEP (state D):\n";
        report += "-".repeat(70) + "\n";
        const dStateCommand = "ps aux | awk '$8==\"D\" || $8~/^D/ {print}'";
        try {
          const dStateOutput = await sshExecutor(dStateCommand);
          if (dStateOutput.trim()) {
            report += "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n";
            report += dStateOutput + "\n";
          } else {
            report += "No processes in uninterruptible sleep.\n";
          }
        } catch {
          report += "Unable to check for D-state processes.\n";
        }

        // Check for high load average
        report += "\nSYSTEM LOAD AVERAGE:\n";
        report += "-".repeat(70) + "\n";
        try {
          const uptimeCommand = "uptime";
          const uptimeOutput = await sshExecutor(uptimeCommand);
          report += uptimeOutput + "\n";
        } catch {
          report += "Unable to get load average.\n";
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
              text: `Error finding zombie processes: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: resource container io profile - Profile container I/O usage
  server.tool(
    "resource container io profile",
    "Profile I/O usage of Docker containers over a specified duration. Shows which containers are performing the most read/write operations. Useful for identifying I/O-intensive workloads. Supports comprehensive output filtering.",
    {
      duration: z
        .number()
        .optional()
        .default(5)
        .describe("Duration in seconds to profile (default: 5)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const duration = args.duration || 5;

        let report = `CONTAINER I/O PROFILE (${duration}s sampling)\n`;
        report += "=".repeat(70) + "\n\n";

        // Get initial stats
        report += "Collecting I/O statistics...\n\n";

        // Use docker stats to get I/O over time
        const statsCommand = `timeout ${duration + 1} docker stats --no-stream --format 'table {{.Name}}\\t{{.BlockIO}}\\t{{.NetIO}}\\t{{.CPUPerc}}\\t{{.MemPerc}}'`;
        const statsOutput = await sshExecutor(statsCommand);

        report += "CONTAINER I/O STATISTICS:\n";
        report += "-".repeat(70) + "\n";
        report += statsOutput + "\n\n";

        // Get detailed container information
        report += "DETAILED CONTAINER INFO:\n";
        report += "-".repeat(70) + "\n";

        try {
          // Get all running containers
          const psCommand = "docker ps --format json";
          const psOutput = await sshExecutor(psCommand);
          const containers = psOutput
            .trim()
            .split("\n")
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line));

          for (const container of containers) {
            report += `\nContainer: ${container.Names}\n`;

            // Get I/O stats from cgroup if available
            try {
              const ioCommand = `docker exec ${container.Names} cat /sys/fs/cgroup/blkio/blkio.throttle.io_service_bytes 2>/dev/null || echo "N/A"`;
              const ioOutput = await sshExecutor(ioCommand);

              if (ioOutput.trim() !== "N/A") {
                // Parse and sum up I/O
                const lines = ioOutput.trim().split("\n");
                let totalRead = 0;
                let totalWrite = 0;

                for (const line of lines) {
                  if (line.includes("Read")) {
                    const bytes = parseInt(line.split(" ").pop() || "0");
                    totalRead += bytes;
                  } else if (line.includes("Write")) {
                    const bytes = parseInt(line.split(" ").pop() || "0");
                    totalWrite += bytes;
                  }
                }

                report += `  Total Read: ${(totalRead / (1024 * 1024)).toFixed(2)} MB\n`;
                report += `  Total Write: ${(totalWrite / (1024 * 1024)).toFixed(2)} MB\n`;
              } else {
                report += `  I/O stats: Not available (container doesn't support cgroup access)\n`;
              }
            } catch {
              report += `  I/O stats: Unable to retrieve\n`;
            }
          }
        } catch {
          report += "Unable to get detailed container info\n";
        }

        // System-wide I/O stats
        report += "\n\nSYSTEM I/O OVERVIEW:\n";
        report += "-".repeat(70) + "\n";
        try {
          const iostatCommand = "iostat -x 1 2 | tail -n +4";
          const iostatOutput = await sshExecutor(iostatCommand);
          report += iostatOutput + "\n";
        } catch {
          report += "iostat not available\n";
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
              text: `Error profiling container I/O: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
