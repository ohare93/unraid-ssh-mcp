import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Interface for container network information
 */
interface ContainerNetwork {
  name: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
}

/**
 * Interface for container information
 */
interface ContainerInfo {
  id: string;
  name: string;
  networks: ContainerNetwork[];
  volumes: string[];
  dependsOn: string[];
  links: string[];
  networkMode: string;
  ports: Array<{ container: string; host: string; protocol: string }>;
}

/**
 * Parse docker inspect output to extract container information
 */
function parseContainerInspect(inspectData: any[]): ContainerInfo[] {
  return inspectData.map((container) => {
    const networks: ContainerNetwork[] = [];

    if (container.NetworkSettings?.Networks) {
      for (const [networkName, networkInfo] of Object.entries(container.NetworkSettings.Networks)) {
        const info = networkInfo as any;
        networks.push({
          name: networkName,
          ipAddress: info.IPAddress || "N/A",
          gateway: info.Gateway || "N/A",
          macAddress: info.MacAddress || "N/A",
        });
      }
    }

    const volumes: string[] = [];
    if (container.Mounts) {
      for (const mount of container.Mounts) {
        if (mount.Type === "volume") {
          volumes.push(mount.Name || mount.Source);
        } else if (mount.Type === "bind") {
          volumes.push(mount.Source);
        }
      }
    }

    const dependsOn: string[] = [];
    if (container.Config?.Labels?.["com.docker.compose.depends_on"]) {
      try {
        const deps = JSON.parse(container.Config.Labels["com.docker.compose.depends_on"]);
        dependsOn.push(...Object.keys(deps));
      } catch {
        // Ignore parse errors
      }
    }

    const links: string[] = [];
    if (container.HostConfig?.Links) {
      links.push(...container.HostConfig.Links.map((link: string) => link.split(":")[0]));
    }

    const networkMode = container.HostConfig?.NetworkMode || "default";

    const ports: Array<{ container: string; host: string; protocol: string }> = [];
    if (container.NetworkSettings?.Ports) {
      for (const [containerPort, hostBindings] of Object.entries(container.NetworkSettings.Ports)) {
        if (hostBindings && Array.isArray(hostBindings)) {
          for (const binding of hostBindings) {
            const b = binding as any;
            ports.push({
              container: containerPort,
              host: `${b.HostIp || "0.0.0.0"}:${b.HostPort}`,
              protocol: containerPort.split("/")[1] || "tcp",
            });
          }
        } else {
          // Port exposed but not mapped
          ports.push({
            container: containerPort,
            host: "not mapped",
            protocol: containerPort.split("/")[1] || "tcp",
          });
        }
      }
    }

    return {
      id: container.Id.substring(0, 12),
      name: container.Name.startsWith("/") ? container.Name.substring(1) : container.Name,
      networks,
      volumes,
      dependsOn,
      links,
      networkMode,
      ports,
    };
  });
}

/**
 * Register all container topology and analysis tools with the MCP server
 */
export function registerContainerTopologyTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: container network topology - Network connectivity map
  server.tool(
    "container network topology",
    "Analyze container network topology. Shows which containers are on which networks, their IP addresses, and network connectivity map. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker inspect $(docker ps -q)";
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output.trim()) {
          return {
            content: [
              {
                type: "text",
                text: "No running containers found.",
              },
            ],
          };
        }

        const inspectData = JSON.parse(output);
        const containers = parseContainerInspect(Array.isArray(inspectData) ? inspectData : [inspectData]);

        // Group containers by network
        const networkMap = new Map<string, ContainerInfo[]>();

        for (const container of containers) {
          for (const network of container.networks) {
            if (!networkMap.has(network.name)) {
              networkMap.set(network.name, []);
            }
            networkMap.get(network.name)!.push(container);
          }
        }

        let result = "Container Network Topology\n";
        result += "=".repeat(60) + "\n\n";

        for (const [networkName, networkContainers] of networkMap.entries()) {
          result += `Network: ${networkName}\n`;
          result += "-".repeat(60) + "\n";

          for (const container of networkContainers) {
            const network = container.networks.find((n) => n.name === networkName)!;
            result += `  Container: ${container.name} (${container.id})\n`;
            result += `    IP Address: ${network.ipAddress}\n`;
            result += `    Gateway: ${network.gateway}\n`;
            result += `    MAC Address: ${network.macAddress}\n`;
            result += `    Network Mode: ${container.networkMode}\n`;
            result += "\n";
          }
          result += "\n";
        }

        // Show containers not on any network
        const containersWithoutNetwork = containers.filter((c) => c.networks.length === 0);
        if (containersWithoutNetwork.length > 0) {
          result += "Containers without network:\n";
          result += "-".repeat(60) + "\n";
          for (const container of containersWithoutNetwork) {
            result += `  ${container.name} (${container.id})\n`;
            result += `    Network Mode: ${container.networkMode}\n`;
          }
        }

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
              text: `Error analyzing network topology: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: container volume sharing - Shared volumes analysis
  server.tool(
    "container volume sharing",
    "Analyze shared volumes between containers. Shows which containers share which volumes. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker inspect $(docker ps -aq)";
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output.trim()) {
          return {
            content: [
              {
                type: "text",
                text: "No containers found.",
              },
            ],
          };
        }

        const inspectData = JSON.parse(output);
        const containers = parseContainerInspect(Array.isArray(inspectData) ? inspectData : [inspectData]);

        // Group containers by shared volumes
        const volumeMap = new Map<string, ContainerInfo[]>();

        for (const container of containers) {
          for (const volume of container.volumes) {
            if (!volumeMap.has(volume)) {
              volumeMap.set(volume, []);
            }
            volumeMap.get(volume)!.push(container);
          }
        }

        let result = "Container Volume Sharing Analysis\n";
        result += "=".repeat(60) + "\n\n";

        // Show only shared volumes (used by 2+ containers)
        const sharedVolumes = Array.from(volumeMap.entries()).filter(([_, containers]) => containers.length > 1);

        if (sharedVolumes.length === 0) {
          result += "No shared volumes found.\n\n";
        } else {
          result += `Shared Volumes (${sharedVolumes.length}):\n`;
          result += "-".repeat(60) + "\n\n";

          for (const [volume, volumeContainers] of sharedVolumes) {
            result += `Volume: ${volume}\n`;
            result += `  Shared by ${volumeContainers.length} containers:\n`;
            for (const container of volumeContainers) {
              result += `    - ${container.name} (${container.id})\n`;
            }
            result += "\n";
          }
        }

        // Show all volume usage
        result += "\nAll Volume Usage:\n";
        result += "-".repeat(60) + "\n\n";

        for (const [volume, volumeContainers] of volumeMap.entries()) {
          result += `Volume: ${volume}\n`;
          result += `  Used by ${volumeContainers.length} container(s):\n`;
          for (const container of volumeContainers) {
            result += `    - ${container.name} (${container.id})\n`;
          }
          result += "\n";
        }

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
              text: `Error analyzing volume sharing: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: container dependency graph - Dependency relationships
  server.tool(
    "container dependency graph",
    "Analyze container dependency relationships. Shows depends_on, links, and network_mode: container: relationships. Optionally filter by specific container. Supports comprehensive output filtering.",
    {
      container: z.string().optional().describe("Container name or ID to focus on (optional)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker inspect $(docker ps -aq)";
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output.trim()) {
          return {
            content: [
              {
                type: "text",
                text: "No containers found.",
              },
            ],
          };
        }

        const inspectData = JSON.parse(output);
        const containers = parseContainerInspect(Array.isArray(inspectData) ? inspectData : [inspectData]);

        let result = "Container Dependency Graph\n";
        result += "=".repeat(60) + "\n\n";

        // Filter by container if specified
        const containersToShow = args.container
          ? containers.filter((c) => c.name === args.container || c.id === args.container)
          : containers;

        if (containersToShow.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Container "${args.container}" not found.`,
              },
            ],
            isError: true,
          };
        }

        for (const container of containersToShow) {
          result += `Container: ${container.name} (${container.id})\n`;
          result += "-".repeat(60) + "\n";

          // Check if this container depends on others
          if (container.dependsOn.length > 0) {
            result += `  Depends on:\n`;
            for (const dep of container.dependsOn) {
              result += `    - ${dep}\n`;
            }
          }

          if (container.links.length > 0) {
            result += `  Links to:\n`;
            for (const link of container.links) {
              result += `    - ${link}\n`;
            }
          }

          // Check if network mode references another container
          if (container.networkMode.startsWith("container:")) {
            const targetContainer = container.networkMode.substring(10);
            result += `  Uses network of:\n`;
            result += `    - ${targetContainer}\n`;
          }

          // Check which containers depend on this one
          const dependents = containers.filter(
            (c) =>
              c.dependsOn.includes(container.name) ||
              c.links.includes(container.name) ||
              c.networkMode === `container:${container.id}` ||
              c.networkMode === `container:${container.name}`
          );

          if (dependents.length > 0) {
            result += `  Depended on by:\n`;
            for (const dep of dependents) {
              result += `    - ${dep.name} (${dep.id})\n`;
            }
          }

          if (
            container.dependsOn.length === 0 &&
            container.links.length === 0 &&
            !container.networkMode.startsWith("container:") &&
            dependents.length === 0
          ) {
            result += `  No dependencies found\n`;
          }

          result += "\n";
        }

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
              text: `Error analyzing dependencies: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: container port conflict check - Identify port conflicts
  server.tool(
    "container port conflict check",
    "Check for port conflicts between containers. Identifies duplicate port mappings that could cause conflicts. Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "docker inspect $(docker ps -aq)";
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        if (!output.trim()) {
          return {
            content: [
              {
                type: "text",
                text: "No containers found.",
              },
            ],
          };
        }

        const inspectData = JSON.parse(output);
        const containers = parseContainerInspect(Array.isArray(inspectData) ? inspectData : [inspectData]);

        let result = "Port Conflict Analysis\n";
        result += "=".repeat(60) + "\n\n";

        // Map of host ports to containers
        const hostPortMap = new Map<string, Array<{ container: string; containerPort: string }>>();

        for (const container of containers) {
          for (const port of container.ports) {
            if (port.host !== "not mapped") {
              if (!hostPortMap.has(port.host)) {
                hostPortMap.set(port.host, []);
              }
              hostPortMap.get(port.host)!.push({
                container: container.name,
                containerPort: port.container,
              });
            }
          }
        }

        // Find conflicts (same host port used by multiple containers)
        const conflicts = Array.from(hostPortMap.entries()).filter(([_, containers]) => containers.length > 1);

        if (conflicts.length === 0) {
          result += "No port conflicts detected.\n\n";
        } else {
          result += `CONFLICTS DETECTED (${conflicts.length}):\n`;
          result += "-".repeat(60) + "\n\n";

          for (const [hostPort, portContainers] of conflicts) {
            result += `Host Port: ${hostPort}\n`;
            result += `  Conflict between:\n`;
            for (const { container, containerPort } of portContainers) {
              result += `    - ${container} (container port: ${containerPort})\n`;
            }
            result += "\n";
          }
        }

        // Show all port mappings
        result += "All Port Mappings:\n";
        result += "-".repeat(60) + "\n\n";

        for (const container of containers) {
          if (container.ports.length > 0) {
            result += `Container: ${container.name}\n`;
            for (const port of container.ports) {
              result += `  ${port.host} -> ${port.container} (${port.protocol})\n`;
            }
            result += "\n";
          }
        }

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
              text: `Error checking port conflicts: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: container communication test - Test container connectivity
  server.tool(
    "container communication test",
    "Test network connectivity between two containers. Uses ping or netcat to verify if containers can communicate. Supports comprehensive output filtering.",
    {
      fromContainer: z.string().describe("Source container name or ID"),
      toContainer: z.string().describe("Target container name or ID"),
      port: z.number().optional().describe("Port to test (uses netcat if specified, otherwise uses ping)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let result = `Container Communication Test\n`;
        result += "=".repeat(60) + "\n\n";
        result += `From: ${args.fromContainer}\n`;
        result += `To: ${args.toContainer}\n`;

        if (args.port) {
          result += `Port: ${args.port}\n\n`;

          // Test with netcat (nc)
          let command = `docker exec ${args.fromContainer} sh -c "command -v nc >/dev/null 2>&1 && nc -zv ${args.toContainer} ${args.port} 2>&1 || echo 'netcat not available in container'"`;
          command = applyFilters(command, args);
          const output = await sshExecutor(command);

          result += "Netcat Test Result:\n";
          result += "-".repeat(60) + "\n";
          result += output;

          if (output.includes("succeeded") || output.includes("open")) {
            result += "\n\nStatus: SUCCESS - Port is reachable\n";
          } else if (output.includes("not available")) {
            result += "\n\nStatus: UNKNOWN - netcat not available in source container\n";
            result += "Try installing netcat or use ping test (omit port parameter)\n";
          } else {
            result += "\n\nStatus: FAILED - Port is not reachable\n";
          }
        } else {
          result += "\n";

          // Test with ping
          let command = `docker exec ${args.fromContainer} ping -c 4 ${args.toContainer}`;
          command = applyFilters(command, args);
          const output = await sshExecutor(command);

          result += "Ping Test Result:\n";
          result += "-".repeat(60) + "\n";
          result += output;

          if (output.includes("4 packets transmitted, 4 received")) {
            result += "\n\nStatus: SUCCESS - Container is reachable\n";
          } else if (output.includes("0 packets transmitted") || output.includes("0 received")) {
            result += "\n\nStatus: FAILED - Container is not reachable\n";
          } else {
            result += "\n\nStatus: PARTIAL - Some packets lost\n";
          }
        }

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
              text: `Error testing communication: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: container dns test - DNS resolution testing
  server.tool(
    "container dns test",
    "Test DNS resolution. Uses nslookup or dig to resolve hostnames. Optionally specify a DNS server. Supports comprehensive output filtering.",
    {
      hostname: z.string().describe("Hostname to resolve"),
      dnsServer: z.string().optional().describe("DNS server to use (optional)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let result = `DNS Resolution Test\n`;
        result += "=".repeat(60) + "\n\n";
        result += `Hostname: ${args.hostname}\n`;

        if (args.dnsServer) {
          result += `DNS Server: ${args.dnsServer}\n`;
        }
        result += "\n";

        // Try nslookup first
        let command = args.dnsServer
          ? `nslookup ${args.hostname} ${args.dnsServer}`
          : `nslookup ${args.hostname}`;
        command = applyFilters(command, args);

        try {
          const output = await sshExecutor(command);
          result += "nslookup Result:\n";
          result += "-".repeat(60) + "\n";
          result += output + "\n";
        } catch (nslookupError) {
          // Try dig if nslookup fails
          command = args.dnsServer
            ? `dig @${args.dnsServer} ${args.hostname}`
            : `dig ${args.hostname}`;

          try {
            const output = await sshExecutor(command);
            result += "dig Result:\n";
            result += "-".repeat(60) + "\n";
            result += output + "\n";
          } catch (digError) {
            result += "Error: Both nslookup and dig failed.\n";
            result += `nslookup error: ${nslookupError instanceof Error ? nslookupError.message : String(nslookupError)}\n`;
            result += `dig error: ${digError instanceof Error ? digError.message : String(digError)}\n`;
          }
        }

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
              text: `Error testing DNS: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 7: container ping test - Connectivity testing
  server.tool(
    "container ping test",
    "Test network connectivity using ping. Default is 4 packets. Supports comprehensive output filtering.",
    {
      host: z.string().describe("Host to ping (IP address or hostname)"),
      count: z.number().optional().default(4).describe("Number of packets to send (default: 4)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const count = args.count ?? 4;
        let command = `ping -c ${count} ${args.host}`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        let result = `Ping Test\n`;
        result += "=".repeat(60) + "\n\n";
        result += `Host: ${args.host}\n`;
        result += `Packets: ${count}\n\n`;
        result += "Result:\n";
        result += "-".repeat(60) + "\n";
        result += output;

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
              text: `Error pinging host: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 8: container traceroute test - Network path tracing
  server.tool(
    "container traceroute test",
    "Trace the network path to a host. Uses traceroute or tracepath. Supports comprehensive output filtering.",
    {
      host: z.string().describe("Host to trace route to (IP address or hostname)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let result = `Traceroute Test\n`;
        result += "=".repeat(60) + "\n\n";
        result += `Host: ${args.host}\n\n`;

        // Try traceroute first
        try {
          let command = `traceroute ${args.host}`;
          command = applyFilters(command, args);
          const output = await sshExecutor(command);
          result += "traceroute Result:\n";
          result += "-".repeat(60) + "\n";
          result += output;
        } catch (tracerouteError) {
          // Try tracepath if traceroute fails
          try {
            const command = `tracepath ${args.host}`;
            const output = await sshExecutor(command);
            result += "tracepath Result:\n";
            result += "-".repeat(60) + "\n";
            result += output;
          } catch (tracepathError) {
            result += "Error: Both traceroute and tracepath failed.\n";
            result += `traceroute error: ${tracerouteError instanceof Error ? tracerouteError.message : String(tracerouteError)}\n`;
            result += `tracepath error: ${tracepathError instanceof Error ? tracepathError.message : String(tracepathError)}\n`;
          }
        }

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
              text: `Error tracing route: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
