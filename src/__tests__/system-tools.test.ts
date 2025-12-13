import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSystemTools } from '../tools/core/system-tools.js';

describe('System Tools', () => {
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
    registerSystemTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 5 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('system')).toBe(true);
    });
  });

  describe('action=list_files', () => {
    it('should require path param', async () => {
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'list_files' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('path required');
    });

    it('should list files', async () => {
      mockSSHExecutor.mockResolvedValue('file1.txt\nfile2.txt');
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'list_files', path: '/tmp' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ls "/tmp"');
      expect(result.content[0].text).toContain('file1.txt');
    });

    it('should support long format', async () => {
      mockSSHExecutor.mockResolvedValue('-rw-r--r-- file1.txt');
      const tool = registeredTools.get('system');
      await tool.handler({ action: 'list_files', path: '/tmp', long: true });
      expect(mockSSHExecutor).toHaveBeenCalledWith('ls -lah "/tmp"');
    });
  });

  describe('action=read_file', () => {
    it('should require path param', async () => {
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'read_file' });
      expect(result.isError).toBe(true);
    });

    it('should read file', async () => {
      mockSSHExecutor.mockResolvedValue('file content');
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'read_file', path: '/tmp/file.txt', maxLines: 100 });
      expect(result.content[0].text).toContain('file content');
    });
  });

  describe('action=find_files', () => {
    it('should require path and pattern', async () => {
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'find_files', path: '/tmp' });
      expect(result.isError).toBe(true);
    });

    it('should find files', async () => {
      mockSSHExecutor.mockResolvedValue('/tmp/file.log');
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'find_files', path: '/tmp', pattern: '*.log' });
      expect(result.content[0].text).toContain('/tmp/file.log');
    });
  });

  describe('action=disk_usage', () => {
    it('should get disk usage', async () => {
      mockSSHExecutor.mockResolvedValue('/dev/sda1 100G 50G 50G 50%');
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'disk_usage' });
      expect(result.content[0].text).toContain('/dev/sda1');
    });

    it('should get usage for specific path', async () => {
      mockSSHExecutor.mockResolvedValue('100G\t/tmp');
      const tool = registeredTools.get('system');
      await tool.handler({ action: 'disk_usage', path: '/tmp' });
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining('/tmp'));
    });
  });

  describe('action=system_info', () => {
    it('should get system info', async () => {
      mockSSHExecutor.mockResolvedValue('Linux 5.15.0');
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'system_info' });
      expect(result.content[0].text).toContain('Linux');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('system');
      const result = await tool.handler({ action: 'system_info' });
      expect(result.isError).toBe(true);
    });
  });
});
