import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUnraidArrayTools as registerUnraidTools } from '../platforms/unraid/array-tools.js';

describe('Unraid Tools', () => {
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
    registerUnraidTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 14 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('unraid')).toBe(true);
    });
  });

  describe('action=array_status', () => {
    it('should get array status from /proc/mdcmd', async () => {
      mockSSHExecutor.mockResolvedValue('mdState=STARTED\nmdResync=0');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'array_status' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('cat /proc/mdcmd');
      expect(result.content[0].text).toContain('Array Status');
    });

    it('should fallback to mdcmd status', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('no /proc/mdcmd'))
        .mockResolvedValueOnce('mdState=STARTED');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'array_status' });
      expect(result.content[0].text).toContain('Array Status');
    });
  });

  describe('action=smart', () => {
    it('should require device param', async () => {
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'smart' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('device required');
    });

    it('should get SMART for SATA drive', async () => {
      mockSSHExecutor.mockResolvedValue('SMART info');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'smart', device: 'sda' });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining('smartctl'));
    });

    it('should get SMART for NVMe drive', async () => {
      mockSSHExecutor.mockResolvedValue('NVMe SMART');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'smart', device: 'nvme0n1' });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining('-d nvme'));
    });
  });

  describe('action=temps', () => {
    it('should get temperatures', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Core 0: +50.0°C')
        .mockResolvedValueOnce('/dev/sda')
        .mockResolvedValueOnce('194 Temperature');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'temps' });
      expect(result.content[0].text).toContain('System Temps');
    });
  });

  describe('action=shares', () => {
    it('should list shares', async () => {
      mockSSHExecutor.mockResolvedValue('appdata\nmedia\nisos');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'shares' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ls -la /mnt/user/');
      expect(result.content[0].text).toContain('Shares');
    });
  });

  describe('action=share_usage', () => {
    it('should get usage for all shares', async () => {
      mockSSHExecutor.mockResolvedValue('100G\tappdata\n200G\tmedia');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'share_usage' });
      expect(result.content[0].text).toContain('All Shares Usage');
    });

    it('should get usage for specific share', async () => {
      mockSSHExecutor.mockResolvedValue('100G\t/mnt/user/appdata');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'share_usage', share: 'appdata' });
      expect(result.content[0].text).toContain('Share Usage - appdata');
    });
  });

  describe('action=parity_status', () => {
    it('should get parity status', async () => {
      mockSSHExecutor.mockResolvedValue('mdState=STARTED\nmdResync=0');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'parity_status' });
      expect(result.content[0].text).toContain('Parity Status');
    });
  });

  describe('action=mover_status', () => {
    it('should get mover status', async () => {
      mockSSHExecutor.mockResolvedValue('');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'mover_status' });
      expect(result.content[0].text).toContain('Not running');
    });
  });

  describe('action=cache_usage', () => {
    it('should get cache usage', async () => {
      mockSSHExecutor.mockResolvedValue('/dev/nvme0n1 500G 200G 300G');
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'cache_usage' });
      expect(result.content[0].text).toContain('Cache Usage');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('unraid');
      const result = await tool.handler({ action: 'shares' });
      expect(result.isError).toBe(true);
    });
  });
});
