import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

interface ContainerNetwork { name: string; ipAddress: string; gateway: string; macAddress: string; }
interface ContainerInfo {
  id: string; name: string; networks: ContainerNetwork[]; volumes: string[];
  dependsOn: string[]; links: string[]; networkMode: string;
  ports: Array<{ container: string; host: string; protocol: string }>;
}

function parseContainerInspect(inspectData: any[]): ContainerInfo[] {
  return inspectData.map((c) => {
    const networks: ContainerNetwork[] = [];
    if (c.NetworkSettings?.Networks) {
      for (const [name, info] of Object.entries(c.NetworkSettings.Networks)) {
        const i = info as any;
        networks.push({ name, ipAddress: i.IPAddress || "N/A", gateway: i.Gateway || "N/A", macAddress: i.MacAddress || "N/A" });
      }
    }
    const volumes: string[] = [];
    if (c.Mounts) {
      for (const m of c.Mounts) {
        volumes.push(m.Type === "volume" ? (m.Name || m.Source) : m.Source);
      }
    }
    const dependsOn: string[] = [];
    if (c.Config?.Labels?.["com.docker.compose.depends_on"]) {
      try { dependsOn.push(...Object.keys(JSON.parse(c.Config.Labels["com.docker.compose.depends_on"]))); } catch {}
    }
    const links: string[] = c.HostConfig?.Links?.map((l: string) => l.split(":")[0]) || [];
    const ports: Array<{ container: string; host: string; protocol: string }> = [];
    if (c.NetworkSettings?.Ports) {
      for (const [cp, bindings] of Object.entries(c.NetworkSettings.Ports)) {
        if (bindings && Array.isArray(bindings)) {
          for (const b of bindings) {
            ports.push({ container: cp, host: `${(b as any).HostIp || "0.0.0.0"}:${(b as any).HostPort}`, protocol: cp.split("/")[1] || "tcp" });
          }
        } else {
          ports.push({ container: cp, host: "not mapped", protocol: cp.split("/")[1] || "tcp" });
        }
      }
    }
    return { id: c.Id.substring(0, 12), name: c.Name.startsWith("/") ? c.Name.substring(1) : c.Name, networks, volumes, dependsOn, links, networkMode: c.HostConfig?.NetworkMode || "default", ports };
  });
}

const topologyActions = ["network_topology", "volume_sharing", "dependency_graph", "port_conflicts", "network_test"] as const;

export function registerContainerTopologyTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "container_topology",
    "Container topology ops.",
    {
      action: z.enum(topologyActions).describe("Action"),
      container: z.string().optional().describe("Container"),
      type: z.enum(["ping", "dns", "traceroute", "container"]).optional().describe("Test type"),
      host: z.string().optional().describe("Target host"),
      fromContainer: z.string().optional().describe("Source container"),
      port: z.number().optional().describe("Port"),
      dnsServer: z.string().optional().describe("DNS server"),
      count: z.number().optional().default(4).describe("Ping count"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "network_topology": {
            const output = await sshExecutor("docker inspect $(docker ps -q)");
            if (!output.trim()) return { content: [{ type: "text", text: "No running containers." }] };
            const containers = parseContainerInspect(JSON.parse(output));
            const networkMap = new Map<string, ContainerInfo[]>();
            for (const c of containers) {
              for (const n of c.networks) {
                if (!networkMap.has(n.name)) networkMap.set(n.name, []);
                networkMap.get(n.name)!.push(c);
              }
            }
            let result = "Network Topology\n" + "=".repeat(60) + "\n\n";
            for (const [name, conts] of networkMap.entries()) {
              result += `Network: ${name}\n` + "-".repeat(60) + "\n";
              for (const c of conts) {
                const n = c.networks.find(x => x.name === name)!;
                result += `  ${c.name} (${c.id})\n    IP: ${n.ipAddress}\n    Gateway: ${n.gateway}\n\n`;
              }
            }
            return { content: [{ type: "text", text: applyFiltersToText(result, args) }] };
          }

          case "volume_sharing": {
            const output = await sshExecutor("docker inspect $(docker ps -aq)");
            if (!output.trim()) return { content: [{ type: "text", text: "No containers." }] };
            const containers = parseContainerInspect(JSON.parse(output));
            const volumeMap = new Map<string, ContainerInfo[]>();
            for (const c of containers) {
              for (const v of c.volumes) {
                if (!volumeMap.has(v)) volumeMap.set(v, []);
                volumeMap.get(v)!.push(c);
              }
            }
            const shared = Array.from(volumeMap.entries()).filter(([, cs]) => cs.length > 1);
            let result = "Volume Sharing\n" + "=".repeat(60) + "\n\n";
            if (shared.length === 0) result += "No shared volumes.\n";
            else {
              result += `Shared Volumes (${shared.length}):\n` + "-".repeat(60) + "\n\n";
              for (const [v, cs] of shared) {
                result += `Volume: ${v}\n  Shared by ${cs.length}:\n`;
                for (const c of cs) result += `    - ${c.name}\n`;
                result += "\n";
              }
            }
            return { content: [{ type: "text", text: applyFiltersToText(result, args) }] };
          }

          case "dependency_graph": {
            const output = await sshExecutor("docker inspect $(docker ps -aq)");
            if (!output.trim()) return { content: [{ type: "text", text: "No containers." }] };
            const containers = parseContainerInspect(JSON.parse(output));
            const toShow = args.container ? containers.filter(c => c.name === args.container || c.id === args.container) : containers;
            if (toShow.length === 0) return { content: [{ type: "text", text: `Container "${args.container}" not found.` }], isError: true };
            let result = "Dependency Graph\n" + "=".repeat(60) + "\n\n";
            for (const c of toShow) {
              result += `${c.name} (${c.id})\n` + "-".repeat(60) + "\n";
              if (c.dependsOn.length) result += `  Depends on: ${c.dependsOn.join(", ")}\n`;
              if (c.links.length) result += `  Links: ${c.links.join(", ")}\n`;
              if (c.networkMode.startsWith("container:")) result += `  Uses network of: ${c.networkMode.substring(10)}\n`;
              const deps = containers.filter(x => x.dependsOn.includes(c.name) || x.links.includes(c.name) || x.networkMode === `container:${c.id}` || x.networkMode === `container:${c.name}`);
              if (deps.length) result += `  Depended by: ${deps.map(d => d.name).join(", ")}\n`;
              result += "\n";
            }
            return { content: [{ type: "text", text: applyFiltersToText(result, args) }] };
          }

          case "port_conflicts": {
            const output = await sshExecutor("docker inspect $(docker ps -aq)");
            if (!output.trim()) return { content: [{ type: "text", text: "No containers." }] };
            const containers = parseContainerInspect(JSON.parse(output));
            const hostPortMap = new Map<string, Array<{ container: string; containerPort: string }>>();
            for (const c of containers) {
              for (const p of c.ports) {
                if (p.host !== "not mapped") {
                  if (!hostPortMap.has(p.host)) hostPortMap.set(p.host, []);
                  hostPortMap.get(p.host)!.push({ container: c.name, containerPort: p.container });
                }
              }
            }
            const conflicts = Array.from(hostPortMap.entries()).filter(([, cs]) => cs.length > 1);
            let result = "Port Conflicts\n" + "=".repeat(60) + "\n\n";
            if (conflicts.length === 0) result += "No conflicts.\n";
            else {
              result += `CONFLICTS (${conflicts.length}):\n` + "-".repeat(60) + "\n\n";
              for (const [hp, cs] of conflicts) {
                result += `Host Port: ${hp}\n  Conflict:\n`;
                for (const { container, containerPort } of cs) result += `    - ${container} (${containerPort})\n`;
                result += "\n";
              }
            }
            return { content: [{ type: "text", text: applyFiltersToText(result, args) }] };
          }

          case "network_test": {
            if (!args.type || !args.host) return { content: [{ type: "text", text: "Error: type and host required" }], isError: true };
            let result = "";
            switch (args.type) {
              case "ping": {
                const count = args.count ?? 4;
                let cmd = applyFilters(`ping -c ${count} ${args.host}`, args);
                const output = await sshExecutor(cmd);
                result = `Ping Test\n${"=".repeat(60)}\n\nHost: ${args.host}\n\n${output}`;
                break;
              }
              case "dns": {
                result = `DNS Test\n${"=".repeat(60)}\n\nHostname: ${args.host}\n`;
                let cmd = args.dnsServer ? `nslookup ${args.host} ${args.dnsServer}` : `nslookup ${args.host}`;
                cmd = applyFilters(cmd, args);
                try {
                  result += await sshExecutor(cmd);
                } catch {
                  cmd = args.dnsServer ? `dig @${args.dnsServer} ${args.host}` : `dig ${args.host}`;
                  try { result += await sshExecutor(cmd); }
                  catch { result += "Both nslookup and dig failed.\n"; }
                }
                break;
              }
              case "traceroute": {
                result = `Traceroute\n${"=".repeat(60)}\n\nHost: ${args.host}\n\n`;
                try {
                  let cmd = applyFilters(`traceroute ${args.host}`, args);
                  result += await sshExecutor(cmd);
                } catch {
                  try { result += await sshExecutor(`tracepath ${args.host}`); }
                  catch { result += "Both traceroute and tracepath failed.\n"; }
                }
                break;
              }
              case "container": {
                if (!args.fromContainer) return { content: [{ type: "text", text: "Error: fromContainer required" }], isError: true };
                result = `Container Test\n${"=".repeat(60)}\n\nFrom: ${args.fromContainer}\nTo: ${args.host}\n`;
                if (args.port) {
                  let cmd = applyFilters(`docker exec ${args.fromContainer} sh -c "command -v nc >/dev/null 2>&1 && nc -zv ${args.host} ${args.port} 2>&1 || echo 'netcat not available'"`, args);
                  const output = await sshExecutor(cmd);
                  result += `Port: ${args.port}\n\n${output}`;
                } else {
                  let cmd = applyFilters(`docker exec ${args.fromContainer} ping -c 4 ${args.host}`, args);
                  result += "\n" + await sshExecutor(cmd);
                }
                break;
              }
            }
            return { content: [{ type: "text", text: result }] };
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
