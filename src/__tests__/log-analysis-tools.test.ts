import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerLogAnalysisTools } from '../tools/core/log-analysis-tools.js';

describe('Log Analysis Tools', () => {
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
    registerLogAnalysisTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 6 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('log')).toBe(true);
    });
  });

  describe('action=grep_all', () => {
    it('should require pattern param', async () => {
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'grep_all' });
      expect(result.isError).toBe(true);
    });

    it('should grep across logs', async () => {
      mockSSHExecutor.mockResolvedValue('matching line');
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'grep_all', pattern: 'error' });
      expect(result.content[0].text).toContain('Search');
    });
  });

  describe('action=error_aggregator', () => {
    it('should aggregate errors', async () => {
      mockSSHExecutor.mockResolvedValue('error: 5 occurrences');
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'error_aggregator', hours: 24 });
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('action=timeline', () => {
    it('should show event timeline', async () => {
      mockSSHExecutor.mockResolvedValue('=== TIMELINE (24h) ===\n2024-01-01 event');
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'timeline', hours: 24 });
      expect(result.content[0].text).toContain('TIMELINE');
    });
  });

  describe('action=parse_docker', () => {
    it('should require container param', async () => {
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'parse_docker' });
      expect(result.isError).toBe(true);
    });

    it('should parse docker logs', async () => {
      mockSSHExecutor.mockResolvedValue('{"level":"info"}');
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'parse_docker', container: 'test' });
      expect(result.content[0].text).toContain('test');
    });
  });

  describe('action=compare_timerange', () => {
    it('should require startTime and endTime', async () => {
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'compare_timerange', startTime: '10 minutes ago' });
      expect(result.isError).toBe(true);
    });

    it('should compare time ranges', async () => {
      mockSSHExecutor.mockResolvedValue('=== EVENTS 10 minutes ago to now ===\nlog entry');
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'compare_timerange', startTime: '10 minutes ago', endTime: 'now' });
      expect(result.content[0].text).toContain('EVENTS');
    });
  });

  describe('action=restart_history', () => {
    it('should show restart history', async () => {
      mockSSHExecutor.mockResolvedValue('=== RESTART HISTORY (24h) ===\ncontainer restarted');
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'restart_history', hours: 24 });
      expect(result.content[0].text).toContain('RESTART HISTORY');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('log');
      const result = await tool.handler({ action: 'error_aggregator' });
      expect(result.isError).toBe(true);
    });
  });
});
