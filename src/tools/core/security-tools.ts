import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const securityActions = ["open_ports", "audit_privileges", "ssh_connections", "cert_expiry"] as const;

export function registerSecurityTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "security",
    "Security ops.",
    {
      action: z.enum(securityActions).describe("Action"),
      certPath: z.string().optional().describe("Certificate path"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "open_ports": {
            const cmd = `if command -v ss >/dev/null 2>&1; then echo "=== Listening Ports (ss) ==="; ss -tulnp; else echo "=== Listening Ports (netstat) ==="; netstat -tulnp; fi; echo ""; echo "=== Summary by Port ==="; if command -v ss >/dev/null 2>&1; then ss -tulnp | grep LISTEN | awk '{print $5}' | cut -d: -f2 | sort -n | uniq -c; else netstat -tulnp | grep LISTEN | awk '{print $4}' | cut -d: -f2 | sort -n | uniq -c; fi`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Open Ports:\n\n${output}`, args) }] };
          }

          case "audit_privileges": {
            const cmd = `if ! command -v docker >/dev/null 2>&1; then echo "Docker not available"; exit 0; fi; echo "=== Privileged Audit ==="; echo ""; containers=$(docker ps --format "{{.Names}}"); if [ -z "$containers" ]; then echo "No running containers"; exit 0; fi; for c in $containers; do echo "Container: $c"; priv=$(docker inspect "$c" --format='{{.HostConfig.Privileged}}'); echo "  Privileged: $priv"; net=$(docker inspect "$c" --format='{{.HostConfig.NetworkMode}}'); echo "  Network: $net"; pid=$(docker inspect "$c" --format='{{.HostConfig.PidMode}}'); echo "  PID: $pid"; cap=$(docker inspect "$c" --format='{{.HostConfig.CapAdd}}'); echo "  Capabilities: $cap"; [ "$priv" = "true" ] && echo "  WARNING: Privileged!"; [ "$net" = "host" ] && echo "  WARNING: Host network!"; echo ""; done`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Privilege Audit:\n\n${output}`, args) }] };
          }

          case "ssh_connections": {
            const cmd = `echo "=== Active SSH ==="; w; echo ""; echo "=== Logged-in Users ==="; who; echo ""; echo "=== Last Logins ==="; last; echo ""; echo "=== Failed Logins ==="; if [ -f /var/log/auth.log ]; then grep "Failed password" /var/log/auth.log 2>/dev/null || echo "No failed attempts"; elif [ -f /var/log/secure ]; then grep "Failed password" /var/log/secure 2>/dev/null || echo "No failed attempts"; else echo "Auth logs not found"; fi`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`SSH Connections:\n\n${output}`, args) }] };
          }

          case "cert_expiry": {
            let cmd: string;
            if (args.certPath) {
              cmd = `if [ ! -f "${args.certPath}" ]; then echo "Not found: ${args.certPath}"; exit 1; fi; echo "=== Certificate: ${args.certPath} ==="; openssl x509 -in "${args.certPath}" -noout -enddate 2>/dev/null || echo "Failed to parse"; openssl x509 -in "${args.certPath}" -noout -subject 2>/dev/null || echo "Failed to get subject"`;
            } else {
              cmd = `echo "=== SSL Certificate Check ==="; echo ""; found=0; for pattern in /etc/ssl/certs/*.crt /etc/pki/tls/certs/*.crt /etc/nginx/ssl/*.crt; do for cert in $pattern; do if [ -f "$cert" ]; then found=1; echo "Certificate: $cert"; expiry=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | cut -d= -f2); if [ -n "$expiry" ]; then echo "  Expires: $expiry"; expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null); now_epoch=$(date +%s); if [ -n "$expiry_epoch" ]; then days_left=$(( ($expiry_epoch - $now_epoch) / 86400 )); echo "  Days left: $days_left"; [ $days_left -lt 30 ] && echo "  WARNING: Expires soon!"; fi; fi; echo ""; fi; done; done; [ $found -eq 0 ] && echo "No certificates found in common locations."`;
            }
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Certificate Check:\n\n${output}`, args) }] };
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
