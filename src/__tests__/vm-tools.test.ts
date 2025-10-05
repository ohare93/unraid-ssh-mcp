import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerVMTools } from '../vm-tools.js';

describe('VM Tools', () => {
  let mockServer: any;
  let mockSSHExecutor: any;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    registeredTools = new Map();

    // Mock MCP server
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredTools.set(name, { name, description, schema, handler });
      }),
    };

    // Mock SSH executor
    mockSSHExecutor = vi.fn();

    // Register tools
    registerVMTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 4 VM tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(4);
      expect(registeredTools.has('vm list')).toBe(true);
      expect(registeredTools.has('vm info')).toBe(true);
      expect(registeredTools.has('vm vnc info')).toBe(true);
      expect(registeredTools.has('vm libvirt logs')).toBe(true);
    });
  });

  describe('vm list', () => {
    it('should list all VMs with status', async () => {
      const mockOutput = ` Id   Name            State
------------------------------------
 1    Ubuntu-VM       running
 2    Windows-10      running
 -    Debian-Server   shut off`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('vm list');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh list --all');
      expect(result.content[0].text).toContain('Virtual Machines');
      expect(result.content[0].text).toContain('Ubuntu-VM');
      expect(result.content[0].text).toContain('Windows-10');
      expect(result.content[0].text).toContain('shut off');
    });

    it('should handle empty VM list', async () => {
      const mockOutput = ` Id   Name   State
--------------------`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('vm list');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Virtual Machines');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('virsh not available'));

      const tool = registeredTools.get('vm list');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing VMs');
      expect(result.content[0].text).toContain('virsh not available');
    });
  });

  describe('vm info', () => {
    it('should get VM resource allocation and config', async () => {
      const mockOutput = `Id:             1
Name:           Ubuntu-VM
UUID:           abc123-def456
OS Type:        hvm
State:          running
CPU(s):         4
CPU time:       10.5s
Max memory:     8388608 KiB
Used memory:    8388608 KiB
Persistent:     yes
Autostart:      enable
Managed save:   no
Security model: none
Security DOI:   0`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('vm info');
      const result = await tool.handler({ vm: 'Ubuntu-VM' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh dominfo Ubuntu-VM');
      expect(result.content[0].text).toContain('VM Info - Ubuntu-VM');
      expect(result.content[0].text).toContain('CPU(s):         4');
      expect(result.content[0].text).toContain('State:          running');
      expect(result.content[0].text).toContain('Autostart:      enable');
    });

    it('should handle VM not found', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Domain not found'));

      const tool = registeredTools.get('vm info');
      const result = await tool.handler({ vm: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting VM info');
    });
  });

  describe('vm vnc info', () => {
    it('should get VNC display info for running VM', async () => {
      mockSSHExecutor.mockResolvedValue(':0');

      const tool = registeredTools.get('vm vnc info');
      const result = await tool.handler({ vm: 'Ubuntu-VM' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh vncdisplay Ubuntu-VM');
      expect(result.content[0].text).toContain('VNC Info - Ubuntu-VM');
      expect(result.content[0].text).toContain('VNC Display: :0');
    });

    it('should handle VM with IP-based VNC display', async () => {
      mockSSHExecutor.mockResolvedValue('192.168.1.100:5900');

      const tool = registeredTools.get('vm vnc info');
      const result = await tool.handler({ vm: 'Windows-10' });

      expect(result.content[0].text).toContain('192.168.1.100:5900');
    });

    it('should handle VM with no VNC display (with XML fallback)', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // First call: vncdisplay returns empty
        .mockResolvedValueOnce('<graphics type="vnc" port="5900" autoport="yes"/>'); // Second call: XML grep

      const tool = registeredTools.get('vm vnc info');
      const result = await tool.handler({ vm: 'Debian-Server' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh vncdisplay Debian-Server');
      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh dumpxml Debian-Server | grep -A 5 "<graphics"');
      expect(result.content[0].text).toContain('No VNC display active');
      expect(result.content[0].text).toContain('Graphics configuration');
    });

    it('should handle VM with no VNC configured', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // First call: vncdisplay returns empty
        .mockRejectedValueOnce(new Error('No graphics element')); // Second call: XML grep fails

      const tool = registeredTools.get('vm vnc info');
      const result = await tool.handler({ vm: 'NoVNC-VM' });

      expect(result.content[0].text).toContain('No VNC display configured or VM is not running');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('VM not found'));

      const tool = registeredTools.get('vm vnc info');
      const result = await tool.handler({ vm: 'missing' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting VNC info');
    });
  });

  describe('vm libvirt logs', () => {
    it('should read logs for specific VM', async () => {
      const mockLogs = `2024-03-15 10:30:00.123+0000: starting up libvirt version: 8.0.0
2024-03-15 10:30:01.456+0000: QEMU_MONITOR_SEND_MSG: mon=0x123456 msg={"execute":"qmp_capabilities"}
2024-03-15 10:30:02.789+0000: Domain id=1 is running`;

      mockSSHExecutor.mockResolvedValue(mockLogs);

      const tool = registeredTools.get('vm libvirt logs');
      const result = await tool.handler({ vm: 'Ubuntu-VM', lines: 100 });

      expect(mockSSHExecutor).toHaveBeenCalledWith('tail -n 100 /var/log/libvirt/qemu/Ubuntu-VM.log');
      expect(result.content[0].text).toContain('Libvirt Logs - Ubuntu-VM');
      expect(result.content[0].text).toContain('last 100 lines');
      expect(result.content[0].text).toContain('starting up libvirt');
    });

    it('should support custom line count', async () => {
      mockSSHExecutor.mockResolvedValue('Recent logs');

      const tool = registeredTools.get('vm libvirt logs');
      await tool.handler({ vm: 'Windows-10', lines: 50 });

      expect(mockSSHExecutor).toHaveBeenCalledWith('tail -n 50 /var/log/libvirt/qemu/Windows-10.log');
    });

    it('should use default lines if not specified', async () => {
      mockSSHExecutor.mockResolvedValue('Default logs');

      const tool = registeredTools.get('vm libvirt logs');
      await tool.handler({ vm: 'Debian-Server' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('tail -n 100 /var/log/libvirt/qemu/Debian-Server.log');
    });

    it('should list all log files when VM not specified', async () => {
      const mockListing = `-rw-r--r-- 1 root root 12K Mar 15 10:30 /var/log/libvirt/qemu/Ubuntu-VM.log
-rw-r--r-- 1 root root 8.5K Mar 15 11:00 /var/log/libvirt/qemu/Windows-10.log
-rw-r--r-- 1 root root 3.2K Mar 14 09:15 /var/log/libvirt/qemu/Debian-Server.log`;

      mockSSHExecutor.mockResolvedValue(mockListing);

      const tool = registeredTools.get('vm libvirt logs');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('ls -lh /var/log/libvirt/qemu/*.log 2>/dev/null || echo \'No log files found\'');
      expect(result.content[0].text).toContain('Available Libvirt Log Files');
      expect(result.content[0].text).toContain('Ubuntu-VM.log');
      expect(result.content[0].text).toContain('To view logs for a specific VM');
    });

    it('should handle no log files found', async () => {
      mockSSHExecutor.mockResolvedValue('No log files found');

      const tool = registeredTools.get('vm libvirt logs');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No log files found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('vm libvirt logs');
      const result = await tool.handler({ vm: 'Ubuntu-VM' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error reading libvirt logs');
      expect(result.content[0].text).toContain('Permission denied');
    });
  });
});
