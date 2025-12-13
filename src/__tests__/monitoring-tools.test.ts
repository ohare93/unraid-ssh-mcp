import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerMonitoringTools } from '../tools/core/monitoring-tools.js';

describe('Monitoring Tools', () => {
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
    registerMonitoringTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 5 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('monitoring')).toBe(true);
    });
  });

  describe('action=ps', () => {
    it('should list processes with default count', async () => {
      mockSSHExecutor.mockResolvedValue('USER PID %CPU %MEM\nroot 1 0.1 0.5');
      const tool = registeredTools.get('monitoring');
      const result = await tool.handler({ action: 'ps' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ps aux | head -n 21');  // 20 + 1 for header
      expect(result.content[0].text).toContain('Process List');
    });

    it('should sort by cpu with count limit', async () => {
      mockSSHExecutor.mockResolvedValue('USER PID %CPU');
      const tool = registeredTools.get('monitoring');
      await tool.handler({ action: 'ps', sortBy: 'cpu' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ps aux --sort=-%cpu | head -n 21');
    });

    it('should sort by memory with count limit', async () => {
      mockSSHExecutor.mockResolvedValue('USER PID %MEM');
      const tool = registeredTools.get('monitoring');
      await tool.handler({ action: 'ps', sortBy: 'memory' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ps aux --sort=-%mem | head -n 21');
    });

    it('should respect custom count parameter', async () => {
      mockSSHExecutor.mockResolvedValue('USER PID %CPU');
      const tool = registeredTools.get('monitoring');
      await tool.handler({ action: 'ps', count: 5 });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ps aux | head -n 6');  // 5 + 1 for header
    });
  });

  describe('action=process_tree', () => {
    it('should show process tree', async () => {
      mockSSHExecutor.mockResolvedValue('init─┬─process');
      const tool = registeredTools.get('monitoring');
      const result = await tool.handler({ action: 'process_tree' });
      expect(result.content[0].text).toContain('Process Tree');
    });
  });

  describe('action=top', () => {
    it('should get top snapshot', async () => {
      mockSSHExecutor.mockResolvedValue('PID USER CPU');
      const tool = registeredTools.get('monitoring');
      const result = await tool.handler({ action: 'top', count: 10 });
      expect(result.content[0].text).toContain('Top');
    });
  });

  describe('action=iostat', () => {
    it('should get I/O stats', async () => {
      mockSSHExecutor.mockResolvedValue('Device: sda\ntps: 100');
      const tool = registeredTools.get('monitoring');
      const result = await tool.handler({ action: 'iostat' });
      expect(result.content[0].text).toContain('I/O');
    });
  });

  describe('action=network_connections', () => {
    it('should show network connections', async () => {
      mockSSHExecutor.mockResolvedValue('LISTEN 0.0.0.0:22');
      const tool = registeredTools.get('monitoring');
      const result = await tool.handler({ action: 'network_connections' });
      expect(result.content[0].text).toContain('Network');
    });

    it('should filter listening ports', async () => {
      mockSSHExecutor.mockResolvedValue('LISTEN 0.0.0.0:22');
      const tool = registeredTools.get('monitoring');
      await tool.handler({ action: 'network_connections', listening: true });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining('ss -tulnp'));
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('monitoring');
      const result = await tool.handler({ action: 'ps' });
      expect(result.isError).toBe(true);
    });
  });
});
