import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPerformanceTools } from '../tools/core/performance-tools.js';

describe('Performance Tools', () => {
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
    registerPerformanceTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 3 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('performance')).toBe(true);
    });
  });

  describe('action=bottleneck', () => {
    it('should identify bottleneck', async () => {
      mockSSHExecutor.mockResolvedValue('%Cpu(s): 10.0 us, 5.0 sy, 0.0 id\nfree -m output');
      const tool = registeredTools.get('performance');
      const result = await tool.handler({ action: 'bottleneck' });
      expect(result.content[0].text).toContain('Bottleneck Analysis');
    });
  });

  describe('action=bandwidth', () => {
    it('should get network bandwidth', async () => {
      mockSSHExecutor.mockResolvedValue('NAME    NET I/O\ntest    1MB / 2MB');
      const tool = registeredTools.get('performance');
      const result = await tool.handler({ action: 'bandwidth' });
      expect(result.content[0].text).toContain('Network Bandwidth');
    });
  });

  describe('action=track_metric', () => {
    it('should require metric param', async () => {
      const tool = registeredTools.get('performance');
      const result = await tool.handler({ action: 'track_metric' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('metric required');
    });

    it('should track cpu metric', async () => {
      mockSSHExecutor.mockResolvedValue('2024-01-01 10:00,50');
      const tool = registeredTools.get('performance');
      const result = await tool.handler({ action: 'track_metric', metric: 'cpu', durationSeconds: 5, intervalSeconds: 5 });
      expect(result.content[0].text).toContain('Metric: cpu');
    });

    it('should track memory metric', async () => {
      mockSSHExecutor.mockResolvedValue('2024-01-01 10:00,75');
      const tool = registeredTools.get('performance');
      const result = await tool.handler({ action: 'track_metric', metric: 'memory', durationSeconds: 5, intervalSeconds: 5 });
      expect(result.content[0].text).toContain('Metric: memory');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('performance');
      const result = await tool.handler({ action: 'bottleneck' });
      expect(result.isError).toBe(true);
    });
  });
});
