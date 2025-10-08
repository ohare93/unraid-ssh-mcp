import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all performance profiling and security audit tools with the MCP server
 * All tools are READ-ONLY and safe for monitoring and auditing operations
 */
export function registerPerformanceSecurityTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: performance identify bottleneck - CPU/disk/network bottleneck analysis
  server.tool(
    "performance identify bottleneck",
    "Analyze system to identify primary performance bottleneck (CPU, disk I/O, or network). Checks CPU usage, disk I/O wait times, and network saturation, then suggests improvements. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Collect multiple metrics to identify bottlenecks
        let commands = `
# Get CPU usage and I/O wait
top -b -n 2 -d 1 | grep "Cpu(s)" | tail -1

# Get disk I/O stats (if iostat available)
if command -v iostat >/dev/null 2>&1; then
  iostat -x 1 2 | tail -n +4 | awk 'NF'
else
  echo "iostat not available"
fi

# Get network interface stats
cat /proc/net/dev

# Get load average
uptime

# Get memory pressure
free -m

# Get top I/O wait processes
ps aux --sort=-%cpu | head -15
`;

        commands = applyFilters(commands, args);
        const output = await sshExecutor(commands);

        // Parse the output to identify bottlenecks
        const lines = output.split("\n");
        let analysis = "System Bottleneck Analysis:\n\n";
        analysis += "=== RAW METRICS ===\n\n";
        analysis += output + "\n\n";
        analysis += "=== ANALYSIS ===\n\n";

        // Simple heuristic analysis
        let bottleneck = "None detected";
        const suggestions: string[] = [];

        // Check for high I/O wait
        const cpuLine = lines.find((l) => l.includes("Cpu(s)") || l.includes("%Cpu"));
        if (cpuLine) {
          const waMatch = cpuLine.match(/(\d+\.?\d*)%?\s*wa/);
          const idMatch = cpuLine.match(/(\d+\.?\d*)%?\s*id/);

          if (waMatch && parseFloat(waMatch[1]) > 10) {
            bottleneck = "Disk I/O";
            suggestions.push("High I/O wait detected. Consider:");
            suggestions.push("- Check disk health with SMART tools");
            suggestions.push("- Identify heavy I/O processes with iotop");
            suggestions.push("- Consider SSD upgrade or RAID optimization");
            suggestions.push("- Review application I/O patterns");
          } else if (idMatch && parseFloat(idMatch[1]) < 20) {
            bottleneck = "CPU";
            suggestions.push("High CPU usage detected. Consider:");
            suggestions.push("- Identify CPU-intensive processes");
            suggestions.push("- Optimize application code");
            suggestions.push("- Add more CPU cores or upgrade CPU");
            suggestions.push("- Implement caching to reduce computation");
          }
        }

        // Check load average
        const uptimeLine = lines.find((l) => l.includes("load average"));
        if (uptimeLine) {
          const loadMatch = uptimeLine.match(/load average:\s*(\d+\.?\d*),\s*(\d+\.?\d*),\s*(\d+\.?\d*)/);
          if (loadMatch) {
            const load1 = parseFloat(loadMatch[1]);
            // Simple heuristic: load > 2 on typical systems suggests overload
            if (load1 > 4 && bottleneck === "None detected") {
              bottleneck = "System Overload";
              suggestions.push("High system load detected. Consider:");
              suggestions.push("- Review running processes and services");
              suggestions.push("- Check for runaway processes");
              suggestions.push("- Consider scaling resources");
            }
          }
        }

        analysis += `Primary Bottleneck: ${bottleneck}\n\n`;
        if (suggestions.length > 0) {
          analysis += "Suggestions:\n" + suggestions.join("\n");
        } else {
          analysis += "System appears to be performing normally.\n";
          analysis += "Suggestions:\n- Continue monitoring during peak usage\n- Set up alerting for resource thresholds";
        }

        return {
          content: [
            {
              type: "text",
              text: analysis,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error analyzing bottlenecks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: performance network bandwidth by container - Network usage per container
  server.tool(
    "performance network bandwidth by container",
    "Show network bandwidth usage per Docker container. Parses docker stats or /sys/class/net/*/statistics/ to display network I/O per container. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Use docker stats for container network I/O
        let command = `
# Get network stats from docker stats
docker stats --no-stream --format "table {{.Container}}\\t{{.Name}}\\t{{.NetIO}}" 2>/dev/null || echo "Docker not available"

# Also show network interface stats for context
echo ""
echo "=== Network Interface Stats ==="
cat /proc/net/dev
`;

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Network Bandwidth by Container:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting network bandwidth: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: performance track metric over time - Sample metrics over time
  server.tool(
    "performance track metric over time",
    "Sample system metrics over time and return time series data. Tracks CPU, memory, or disk metrics at specified intervals. Useful for identifying trends and patterns. Supports comprehensive output filtering.",
    {
      metric: z.enum(["cpu", "memory", "disk"]).describe("Metric to track: 'cpu', 'memory', or 'disk'"),
      durationSeconds: z.number().int().positive().optional().default(30).describe("Total duration to track in seconds (default: 30)"),
      intervalSeconds: z.number().int().positive().optional().default(5).describe("Sampling interval in seconds (default: 5)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const metric = args.metric;
        const duration = args.durationSeconds ?? 30;
        const interval = args.intervalSeconds ?? 5;
        const samples = Math.floor(duration / interval);

        let command = "";

        if (metric === "cpu") {
          // Sample CPU usage over time
          command = `
for i in $(seq 1 ${samples}); do
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  cpu=$(top -b -n 1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
  echo "$timestamp,$cpu"
  [ $i -lt ${samples} ] && sleep ${interval}
done
`;
        } else if (metric === "memory") {
          // Sample memory usage over time
          command = `
for i in $(seq 1 ${samples}); do
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  mem=$(free -m | awk 'NR==2{printf "%.2f", $3*100/$2}')
  echo "$timestamp,$mem"
  [ $i -lt ${samples} ] && sleep ${interval}
done
`;
        } else if (metric === "disk") {
          // Sample disk usage over time
          command = `
for i in $(seq 1 ${samples}); do
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  disk=$(df -h / | awk 'NR==2{print $5}' | cut -d'%' -f1)
  echo "$timestamp,$disk"
  [ $i -lt ${samples} ] && sleep ${interval}
done
`;
        }

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        const result = `Metric Tracking: ${metric}\nDuration: ${duration}s, Interval: ${interval}s, Samples: ${samples}\n\nTimestamp,Value\n${output}\n\nNote: Values represent percentage usage for the tracked metric.`;

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error tracking metric: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: security check open ports - List externally open ports
  server.tool(
    "security check open ports",
    "List all externally open ports and the processes listening on them. Uses ss or netstat to show listening TCP and UDP ports with process information. Important for security auditing. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Use ss if available, fallback to netstat
        // -t: TCP, -u: UDP, -l: listening, -n: numeric, -p: process
        let command = `
if command -v ss >/dev/null 2>&1; then
  echo "=== Listening Ports (ss) ==="
  ss -tulnp | head -50
else
  echo "=== Listening Ports (netstat) ==="
  netstat -tulnp | head -50
fi

echo ""
echo "=== Summary by Port ==="
if command -v ss >/dev/null 2>&1; then
  ss -tulnp | grep LISTEN | awk '{print $5}' | cut -d: -f2 | sort -n | uniq -c
else
  netstat -tulnp | grep LISTEN | awk '{print $4}' | cut -d: -f2 | sort -n | uniq -c
fi
`;

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Open Ports Security Audit:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking open ports: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: security audit container privileges - Privileged container audit
  server.tool(
    "security audit container privileges",
    "Audit Docker containers for elevated privileges and security concerns. Checks for privileged mode, host network mode, and dangerous capabilities. Essential for container security. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not available"
  exit 0
fi

echo "=== Privileged Container Audit ==="
echo ""

# Get all running containers
containers=$(docker ps --format "{{.Names}}")

if [ -z "$containers" ]; then
  echo "No running containers found"
  exit 0
fi

for container in $containers; do
  echo "Container: $container"

  # Check if privileged
  privileged=$(docker inspect "$container" --format='{{.HostConfig.Privileged}}')
  echo "  Privileged: $privileged"

  # Check network mode
  network_mode=$(docker inspect "$container" --format='{{.HostConfig.NetworkMode}}')
  echo "  Network Mode: $network_mode"

  # Check if has host PID namespace
  pid_mode=$(docker inspect "$container" --format='{{.HostConfig.PidMode}}')
  echo "  PID Mode: $pid_mode"

  # Check capabilities
  cap_add=$(docker inspect "$container" --format='{{.HostConfig.CapAdd}}')
  echo "  Added Capabilities: $cap_add"

  # Security warnings
  if [ "$privileged" = "true" ]; then
    echo "  WARNING: Container is running in privileged mode!"
  fi
  if [ "$network_mode" = "host" ]; then
    echo "  WARNING: Container is using host network!"
  fi
  if [ "$pid_mode" = "host" ]; then
    echo "  WARNING: Container is using host PID namespace!"
  fi

  echo ""
done

echo "=== Summary ==="
echo "Privileged containers:"
docker ps --format "{{.Names}}" | while read name; do
  priv=$(docker inspect "$name" --format='{{.HostConfig.Privileged}}')
  [ "$priv" = "true" ] && echo "  - $name"
done
`;

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Container Privilege Audit:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error auditing container privileges: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: security check ssh connections - Active SSH sessions
  server.tool(
    "security check ssh connections",
    "Show active SSH sessions and connections. Lists all logged-in users, their connection sources, login times, and current activities. Useful for security monitoring. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `
echo "=== Active SSH Sessions ==="
w

echo ""
echo "=== All Logged-in Users ==="
who

echo ""
echo "=== Last Logins ==="
last -n 20

echo ""
echo "=== Failed Login Attempts ==="
if [ -f /var/log/auth.log ]; then
  grep "Failed password" /var/log/auth.log 2>/dev/null | tail -20 || echo "No failed attempts in auth.log"
elif [ -f /var/log/secure ]; then
  grep "Failed password" /var/log/secure 2>/dev/null | tail -20 || echo "No failed attempts in secure log"
else
  echo "Auth logs not accessible or not found"
fi
`;

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `SSH Connection Audit:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking SSH connections: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 7: security check cert expiry - SSL certificate expiration
  server.tool(
    "security check cert expiry",
    "Check SSL/TLS certificate expiration dates. Scans common certificate locations or a specified path. Shows certificate details including subject, issuer, and expiration date. Helps prevent service disruptions from expired certificates. Supports comprehensive output filtering.",
    {
      certPath: z.string().optional().describe("Optional specific certificate file path to check. If not provided, checks common locations."),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "";

        if (args.certPath) {
          // Check specific certificate
          command = `
if [ ! -f "${args.certPath}" ]; then
  echo "Certificate file not found: ${args.certPath}"
  exit 1
fi

echo "=== Certificate: ${args.certPath} ==="
openssl x509 -in "${args.certPath}" -noout -text 2>/dev/null || echo "Failed to parse certificate"
echo ""
echo "Expiration Date:"
openssl x509 -in "${args.certPath}" -noout -enddate 2>/dev/null || echo "Failed to get expiration"
echo ""
echo "Subject:"
openssl x509 -in "${args.certPath}" -noout -subject 2>/dev/null || echo "Failed to get subject"
`;
        } else {
          // Check common certificate locations
          command = `
echo "=== SSL Certificate Expiration Check ==="
echo ""

# Common certificate locations
cert_paths=(
  "/etc/ssl/certs/*.crt"
  "/etc/pki/tls/certs/*.crt"
  "/etc/nginx/ssl/*.crt"
  "/etc/apache2/ssl/*.crt"
  "/usr/local/share/ca-certificates/*.crt"
)

found=0

for pattern in "\${cert_paths[@]}"; do
  for cert in $pattern; do
    if [ -f "$cert" ]; then
      found=1
      echo "Certificate: $cert"

      # Get expiration date
      expiry=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | cut -d= -f2)
      if [ -n "$expiry" ]; then
        echo "  Expires: $expiry"

        # Calculate days until expiry
        expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null)
        now_epoch=$(date +%s)
        if [ -n "$expiry_epoch" ]; then
          days_left=$(( ($expiry_epoch - $now_epoch) / 86400 ))
          echo "  Days until expiry: $days_left"

          if [ $days_left -lt 30 ]; then
            echo "  WARNING: Certificate expires in less than 30 days!"
          fi
        fi
      fi

      # Get subject
      subject=$(openssl x509 -in "$cert" -noout -subject 2>/dev/null | cut -d= -f2-)
      [ -n "$subject" ] && echo "  Subject: $subject"

      echo ""
    fi
  done
done

if [ $found -eq 0 ]; then
  echo "No certificates found in common locations."
  echo "Use certPath parameter to check a specific certificate."
fi

# Check if openssl is available
if ! command -v openssl >/dev/null 2>&1; then
  echo ""
  echo "WARNING: openssl command not found. Install openssl to check certificates."
fi
`;
        }

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `SSL Certificate Expiration Check:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error checking certificate expiry: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
