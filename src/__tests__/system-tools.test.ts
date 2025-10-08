import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSystemTools } from '../system-tools.js';

describe('System Tools', () => {
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
    registerSystemTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 5 system tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(5);
      expect(registeredTools.has('system list files')).toBe(true);
      expect(registeredTools.has('system read file')).toBe(true);
      expect(registeredTools.has('system find files')).toBe(true);
      expect(registeredTools.has('system disk usage')).toBe(true);
      expect(registeredTools.has('system get system info')).toBe(true);
    });
  });

  describe('system list files', () => {
    it('should list files in directory', async () => {
      mockSSHExecutor.mockResolvedValue('file1.txt\nfile2.log\ndir1');

      const tool = registeredTools.get('system list files');
      const result = await tool.handler({ path: '/var/log' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('ls "/var/log"');
      expect(result.content[0].text).toContain('file1.txt');
      expect(result.content[0].text).toContain('file2.log');
    });

    it('should use long format when requested', async () => {
      mockSSHExecutor.mockResolvedValue('total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 file.txt');

      const tool = registeredTools.get('system list files');
      const result = await tool.handler({ path: '/home', long: true });

      expect(mockSSHExecutor).toHaveBeenCalledWith('ls -lah "/home"');
      expect(result.content[0].text).toContain('drwxr-xr-x');
    });

    it('should handle paths with spaces', async () => {
      mockSSHExecutor.mockResolvedValue('file.txt');

      const tool = registeredTools.get('system list files');
      await tool.handler({ path: '/path/with spaces' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('ls "/path/with spaces"');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('system list files');
      const result = await tool.handler({ path: '/root' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list files');
      expect(result.content[0].text).toContain('Permission denied');
    });
  });

  describe('system read file', () => {
    it('should read file contents', async () => {
      mockSSHExecutor.mockResolvedValue('Line 1\nLine 2\nLine 3');

      const tool = registeredTools.get('system read file');
      const result = await tool.handler({ path: '/var/log/syslog' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('head -n 1000 "/var/log/syslog"');
      expect(result.content[0].text).toContain('Line 1');
      expect(result.content[0].text).toContain('Line 2');
    });

    it('should respect maxLines parameter', async () => {
      mockSSHExecutor.mockResolvedValue('Line 1\nLine 2');

      const tool = registeredTools.get('system read file');
      await tool.handler({ path: '/test.txt', maxLines: 10 });

      expect(mockSSHExecutor).toHaveBeenCalledWith('head -n 10 "/test.txt"');
    });

    it('should add truncation warning when hitting maxLines', async () => {
      // Create output with exactly 100 lines
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
      mockSSHExecutor.mockResolvedValue(lines);

      const tool = registeredTools.get('system read file');
      const result = await tool.handler({ path: '/large.txt', maxLines: 100 });

      expect(result.content[0].text).toContain('[Note: Output limited to 100 lines');
    });

    it('should handle file read errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('File not found'));

      const tool = registeredTools.get('system read file');
      const result = await tool.handler({ path: '/nonexistent.txt' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to read file');
    });
  });

  describe('system find files', () => {
    it('should find files by pattern', async () => {
      mockSSHExecutor.mockResolvedValue('/var/log/app.log\n/var/log/error.log\n/var/log/access.log');

      const tool = registeredTools.get('system find files');
      const result = await tool.handler({ path: '/var/log', pattern: '*.log' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('find "/var/log" -name "*.log" -type f 2>/dev/null');
      expect(result.content[0].text).toContain('app.log');
      expect(result.content[0].text).toContain('error.log');
    });

    it('should handle no files found', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('system find files');
      const result = await tool.handler({ path: '/tmp', pattern: '*.xyz' });

      expect(result.content[0].text).toContain('No files matching pattern "*.xyz" found');
    });

    it('should truncate results when exceeding max', async () => {
      // Create 1500 file results
      const files = Array.from({ length: 1500 }, (_, i) => `/path/file${i}.txt`).join('\n');
      mockSSHExecutor.mockResolvedValue(files);

      const tool = registeredTools.get('system find files');
      const result = await tool.handler({ path: '/', pattern: '*.txt' });

      expect(result.content[0].text).toContain('[Note: Found 1500 files, showing first 1000 results]');
    });

    it('should handle find errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('system find files');
      const result = await tool.handler({ path: '/root', pattern: '*' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to find files');
    });
  });

  describe('system disk usage', () => {
    it('should check disk usage for default path', async () => {
      mockSSHExecutor.mockResolvedValue('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       100G   50G   45G  53% /');

      const tool = registeredTools.get('system disk usage');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('df -h "/"');
      expect(result.content[0].text).toContain('/dev/sda1');
      expect(result.content[0].text).toContain('53%');
    });

    it('should check disk usage for specific path', async () => {
      mockSSHExecutor.mockResolvedValue('Filesystem      Size  Used Avail Use% Mounted on\n/dev/sdb1       500G  200G  280G  42% /mnt/data');

      const tool = registeredTools.get('system disk usage');
      const result = await tool.handler({ path: '/mnt/data' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('df -h "/mnt/data"');
      expect(result.content[0].text).toContain('/mnt/data');
    });

    it('should handle disk usage errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Path not found'));

      const tool = registeredTools.get('system disk usage');
      const result = await tool.handler({ path: '/invalid' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to check disk usage');
    });
  });

  describe('system get system info', () => {
    it('should get comprehensive system info', async () => {
      const mockInfo = `Linux unraid 5.15.0-unraid #1 SMP x86_64 GNU/Linux
---
 10:30:42 up 5 days, 12:34,  2 users,  load average: 0.50, 0.45, 0.40
---
              total        used        free      shared  buff/cache   available
Mem:           32Gi       8.0Gi       20Gi       100Mi       4.0Gi       24Gi
Swap:         8.0Gi          0B       8.0Gi`;

      mockSSHExecutor.mockResolvedValue(mockInfo);

      const tool = registeredTools.get('system get system info');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('uname -a && echo "---" && uptime && echo "---" && free -h');
      expect(result.content[0].text).toContain('Linux unraid');
      expect(result.content[0].text).toContain('up 5 days');
      expect(result.content[0].text).toContain('32Gi');
    });

    it('should handle system info errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Command failed'));

      const tool = registeredTools.get('system get system info');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to get system info');
    });
  });
});
