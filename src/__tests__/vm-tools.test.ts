import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerVMTools } from '../tools/core/vm-tools.js';

describe('VM Tools', () => {
  let mockServer: any;
  let mockSSHExecutor: any;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    registeredTools = new Map();
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredTools.set(name, { name, description, schema, handler });
      }),
    };
    mockSSHExecutor = vi.fn();
    registerVMTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 4 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('vm')).toBe(true);
    });
  });

  describe('action=list', () => {
    it('should list all VMs', async () => {
      mockSSHExecutor.mockResolvedValue(` Id   Name            State\n 1    Ubuntu-VM       running`);
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'list' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh list --all');
      expect(result.content[0].text).toContain('VMs');
    });

    it('should handle errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('virsh not available'));
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'list' });
      expect(result.isError).toBe(true);
    });
  });

  describe('action=info', () => {
    it('should require vm param', async () => {
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'info' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('vm required');
    });

    it('should get VM info', async () => {
      mockSSHExecutor.mockResolvedValue('State: running\nCPU(s): 4');
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'info', vm: 'Ubuntu-VM' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('virsh dominfo Ubuntu-VM');
      expect(result.content[0].text).toContain('VM Info - Ubuntu-VM');
    });
  });

  describe('action=vnc', () => {
    it('should require vm param', async () => {
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'vnc' });
      expect(result.isError).toBe(true);
    });

    it('should get VNC display', async () => {
      mockSSHExecutor.mockResolvedValue(':0');
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'vnc', vm: 'Ubuntu-VM' });
      expect(result.content[0].text).toContain('Display: :0');
    });

    it('should handle empty VNC with XML fallback', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('<graphics type="vnc"/>');
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'vnc', vm: 'Test' });
      expect(result.content[0].text).toContain('No VNC active');
    });
  });

  describe('action=logs', () => {
    it('should read VM logs', async () => {
      mockSSHExecutor.mockResolvedValue('Log content');
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'logs', vm: 'Ubuntu-VM', lines: 50 });
      expect(mockSSHExecutor).toHaveBeenCalledWith('tail -n 50 /var/log/libvirt/qemu/Ubuntu-VM.log');
    });

    it('should list log files when no VM specified', async () => {
      mockSSHExecutor.mockResolvedValue('Ubuntu-VM.log');
      const tool = registeredTools.get('vm');
      const result = await tool.handler({ action: 'logs' });
      expect(result.content[0].text).toContain('Log Files');
    });
  });
});
