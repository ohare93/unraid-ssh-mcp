import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all VM management tools with the MCP server
 */
export function registerVMTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: vm list - List VMs with status
  server.tool(
    "vm list",
    "List all virtual machines with their status. Returns VM names, IDs, and states (running, shut off, paused, etc.). Supports comprehensive output filtering.",
    {
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = "virsh list --all";
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Virtual Machines:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing VMs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: vm info - VM resource allocation and config
  server.tool(
    "vm info",
    "Get detailed information about a virtual machine including CPU, memory, state, autostart, and other configuration details. Supports comprehensive output filtering.",
    {
      vm: z.string().describe("VM name"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        let command = `virsh dominfo ${args.vm}`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `VM Info - ${args.vm}:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting VM info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: vm vnc info - VNC connection details
  server.tool(
    "vm vnc info",
    "Get VNC connection details for a virtual machine. Shows VNC port/display information for remote access. Supports comprehensive output filtering.",
    {
      vm: z.string().describe("VM name"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Try to get VNC display using virsh vncdisplay
        let command = `virsh vncdisplay ${args.vm}`;
        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        const result = output.trim();

        if (!result) {
          // If no VNC display, try to parse VM XML for graphics info
          const xmlCommand = `virsh dumpxml ${args.vm} | grep -A 5 "<graphics"`;
          try {
            const xmlOutput = await sshExecutor(xmlCommand);
            return {
              content: [
                {
                  type: "text",
                  text: `VNC Info - ${args.vm}:\n\nNo VNC display active. Graphics configuration:\n${xmlOutput}`,
                },
              ],
            };
          } catch {
            return {
              content: [
                {
                  type: "text",
                  text: `VNC Info - ${args.vm}:\n\nNo VNC display configured or VM is not running.`,
                },
              ],
            };
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `VNC Info - ${args.vm}:\n\nVNC Display: ${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting VNC info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: vm libvirt logs - Read libvirt logs
  server.tool(
    "vm libvirt logs",
    "Read libvirt/QEMU logs for virtual machines. Can show logs for a specific VM or all VMs. Useful for debugging VM issues. Supports comprehensive output filtering.",
    {
      vm: z.string().optional().describe("VM name (optional - if not specified, shows all available log files)"),
      lines: z.number().optional().default(100).describe("Number of lines to show from end of log (default: 100)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const lines = args.lines ?? 100;

        if (args.vm) {
          // Show logs for specific VM
          let command = `tail -n ${lines} /var/log/libvirt/qemu/${args.vm}.log`;
          command = applyFilters(command, args);
          const output = await sshExecutor(command);

          return {
            content: [
              {
                type: "text",
                text: `Libvirt Logs - ${args.vm} (last ${lines} lines):\n\n${output}`,
              },
            ],
          };
        } else {
          // List all available log files
          let listCommand = "ls -lh /var/log/libvirt/qemu/*.log 2>/dev/null || echo 'No log files found'";
          listCommand = applyFilters(listCommand, args);
          const output = await sshExecutor(listCommand);

          return {
            content: [
              {
                type: "text",
                text: `Available Libvirt Log Files:\n\n${output}\n\nTo view logs for a specific VM, use the 'vm' parameter.`,
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading libvirt logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
