import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const vmActions = ["list", "info", "vnc", "logs"] as const;

export function registerVMTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  server.tool(
    "vm",
    "VM ops.",
    {
      action: z.enum(vmActions).describe("Action"),
      vm: z.string().optional().describe("VM name"),
      lines: z.number().optional().default(100).describe("Lines"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "list": {
            let cmd = applyFilters("virsh list --all", args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `VMs:\n\n${output}` }] };
          }

          case "info": {
            if (!args.vm) return { content: [{ type: "text", text: "Error: vm required" }], isError: true };
            let cmd = applyFilters(`virsh dominfo ${args.vm}`, args);
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: `VM Info - ${args.vm}:\n\n${output}` }] };
          }

          case "vnc": {
            if (!args.vm) return { content: [{ type: "text", text: "Error: vm required" }], isError: true };
            let cmd = applyFilters(`virsh vncdisplay ${args.vm}`, args);
            const output = await sshExecutor(cmd);
            const result = output.trim();
            if (!result) {
              try {
                const xmlOutput = await sshExecutor(`virsh dumpxml ${args.vm} | grep -A 5 "<graphics"`);
                return { content: [{ type: "text", text: `VNC - ${args.vm}:\n\nNo VNC active. Config:\n${xmlOutput}` }] };
              } catch {
                return { content: [{ type: "text", text: `VNC - ${args.vm}:\n\nNo VNC configured or VM not running.` }] };
              }
            }
            return { content: [{ type: "text", text: `VNC - ${args.vm}:\n\nDisplay: ${result}` }] };
          }

          case "logs": {
            const lines = args.lines ?? 100;
            if (args.vm) {
              let cmd = applyFilters(`tail -n ${lines} /var/log/libvirt/qemu/${args.vm}.log`, args);
              const output = await sshExecutor(cmd);
              return { content: [{ type: "text", text: `Logs - ${args.vm} (${lines} lines):\n\n${output}` }] };
            } else {
              let cmd = applyFilters("ls -lh /var/log/libvirt/qemu/*.log 2>/dev/null || echo 'No logs'", args);
              const output = await sshExecutor(cmd);
              return { content: [{ type: "text", text: `Log Files:\n\n${output}` }] };
            }
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
