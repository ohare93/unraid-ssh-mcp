import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerResourceManagementTools } from '../tools/core/resource-management-tools.js';

describe('Resource Management Tools', () => {
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
    registerResourceManagementTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 6 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('resource')).toBe(true);
    });
  });

  describe('action=dangling', () => {
    it('should find dangling resources', async () => {
      mockSSHExecutor.mockResolvedValue('{}');
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'dangling' });
      expect(result.content[0].text).toContain('DANGLING');
    });
  });

  describe('action=hogs', () => {
    it('should find resource hogs', async () => {
      mockSSHExecutor.mockResolvedValue('USER PID %CPU');
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'hogs', sortBy: 'cpu', limit: 10 });
      expect(result.content[0].text).toContain('TOP');
    });
  });

  describe('action=disk_analyzer', () => {
    it('should analyze disk', async () => {
      mockSSHExecutor.mockResolvedValue('100G\t/mnt/user');
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'disk_analyzer', path: '/mnt/user' });
      expect(result.content[0].text).toContain('DISK ANALYSIS');
    });
  });

  describe('action=docker_df', () => {
    it('should get docker disk usage', async () => {
      mockSSHExecutor.mockResolvedValue('TYPE   TOTAL   ACTIVE');
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'docker_df' });
      expect(result.content[0].text).toContain('DOCKER DISK');
    });
  });

  describe('action=zombies', () => {
    it('should find zombie processes', async () => {
      mockSSHExecutor.mockResolvedValue('');
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'zombies' });
      expect(result.content[0].text).toContain('ZOMBIE');
    });
  });

  describe('action=io_profile', () => {
    it('should profile I/O', async () => {
      mockSSHExecutor.mockResolvedValue('NAME   BlockIO');
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'io_profile', duration: 5 });
      expect(result.content[0].text).toContain('I/O PROFILE');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('resource');
      const result = await tool.handler({ action: 'docker_df' });
      expect(result.isError).toBe(true);
    });
  });
});
