import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDockerAdvancedTools } from '../docker-advanced-tools.js';

describe('Docker Advanced Tools', () => {
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
    registerDockerAdvancedTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 4 advanced Docker tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(4);
      expect(registeredTools.has('docker container env')).toBe(true);
      expect(registeredTools.has('docker top')).toBe(true);
      expect(registeredTools.has('docker health check all')).toBe(true);
      expect(registeredTools.has('docker logs aggregate')).toBe(true);
    });
  });

  describe('docker container env', () => {
    it('should show container environment variables', async () => {
      const mockEnv = `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOSTNAME=container123
NODE_ENV=production
DATABASE_URL=postgres://localhost:5432/mydb`;

      mockSSHExecutor.mockResolvedValue(mockEnv);

      const tool = registeredTools.get('docker container env');
      const result = await tool.handler({ container: 'my-app' });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        "docker inspect --format='{{range .Config.Env}}{{println .}}{{end}}' my-app"
      );
      expect(result.content[0].text).toContain('Environment Variables - my-app');
      expect(result.content[0].text).toContain('PATH=');
      expect(result.content[0].text).toContain('NODE_ENV=production');
      expect(result.content[0].text).toContain('DATABASE_URL=');
    });

    it('should handle container with no environment variables', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker container env');
      const result = await tool.handler({ container: 'minimal-container' });

      expect(result.content[0].text).toContain('No environment variables found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Container not found'));

      const tool = registeredTools.get('docker container env');
      const result = await tool.handler({ container: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving environment variables');
      expect(result.content[0].text).toContain('Container not found');
    });
  });

  describe('docker top', () => {
    it('should show processes running in container', async () => {
      const mockTop = `UID                 PID                 PPID                C                   STIME               TTY                 TIME                CMD
root                1234                5678                0                   10:30               ?                   00:00:01            nginx: master process
www-data            1235                1234                0                   10:30               ?                   00:00:00            nginx: worker process`;

      mockSSHExecutor.mockResolvedValue(mockTop);

      const tool = registeredTools.get('docker top');
      const result = await tool.handler({ container: 'web-server' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker top web-server');
      expect(result.content[0].text).toContain('Processes in Container - web-server');
      expect(result.content[0].text).toContain('nginx: master process');
      expect(result.content[0].text).toContain('nginx: worker process');
      expect(result.content[0].text).toContain('PID');
      expect(result.content[0].text).toContain('CMD');
    });

    it('should handle containers with single process', async () => {
      const mockTop = `UID                 PID                 PPID                C                   STIME               TTY                 TIME                CMD
root                9999                0                   0                   09:00               ?                   00:00:00            /app/server`;

      mockSSHExecutor.mockResolvedValue(mockTop);

      const tool = registeredTools.get('docker top');
      const result = await tool.handler({ container: 'simple-app' });

      expect(result.content[0].text).toContain('/app/server');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Container is not running'));

      const tool = registeredTools.get('docker top');
      const result = await tool.handler({ container: 'stopped-container' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving container processes');
      expect(result.content[0].text).toContain('Container is not running');
    });
  });

  describe('docker health check all', () => {
    it('should show health status of all containers', async () => {
      const mockOutput = `{"ID":"abc123","Names":"healthy-app","Image":"nginx","Status":"Up 2 hours (healthy)","State":"running"}
{"ID":"def456","Names":"unhealthy-app","Image":"redis","Status":"Up 1 hour (unhealthy)","State":"running"}
{"ID":"ghi789","Names":"no-health","Image":"postgres","Status":"Up 3 hours","State":"running"}
{"ID":"jkl012","Names":"starting-app","Image":"mysql","Status":"Up 30 seconds (health: starting)","State":"running"}`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker health check all');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker ps -a --format json');
      expect(result.content[0].text).toContain('Container Health Status (4 containers)');
      expect(result.content[0].text).toContain('healthy-app');
      expect(result.content[0].text).toContain('Health: healthy');
      expect(result.content[0].text).toContain('unhealthy-app');
      expect(result.content[0].text).toContain('Health: unhealthy');
      expect(result.content[0].text).toContain('no-health');
      expect(result.content[0].text).toContain('Health: no healthcheck');
      expect(result.content[0].text).toContain('starting-app');
      expect(result.content[0].text).toContain('Health: starting');
    });

    it('should handle no containers', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker health check all');
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('No containers found.');
    });

    it('should handle only healthy containers', async () => {
      const mockOutput = `{"ID":"abc123","Names":"app1","Image":"nginx","Status":"Up 2 hours (healthy)","State":"running"}
{"ID":"def456","Names":"app2","Image":"nginx","Status":"Up 1 hour (healthy)","State":"running"}`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker health check all');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Health: healthy');
      expect(result.content[0].text).not.toContain('unhealthy');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker daemon not running'));

      const tool = registeredTools.get('docker health check all');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving health status');
      expect(result.content[0].text).toContain('Docker daemon not running');
    });
  });

  describe('docker logs aggregate', () => {
    it('should search logs across multiple containers', async () => {
      // First call gets container list
      mockSSHExecutor.mockResolvedValueOnce('app1\napp2\napp3');

      // Subsequent calls get logs for each container
      mockSSHExecutor.mockResolvedValueOnce('Error: connection timeout'); // app1
      mockSSHExecutor.mockResolvedValueOnce(''); // app2 - no matches
      mockSSHExecutor.mockResolvedValueOnce('Error: database connection failed'); // app3

      const tool = registeredTools.get('docker logs aggregate');
      const result = await tool.handler({ pattern: 'error', lines: 50 });

      expect(mockSSHExecutor).toHaveBeenCalledWith("docker ps --format '{{.Names}}'");
      expect(mockSSHExecutor).toHaveBeenCalledWith("docker logs --tail 50 app1 2>&1 | grep -i 'error' || true");
      expect(mockSSHExecutor).toHaveBeenCalledWith("docker logs --tail 50 app2 2>&1 | grep -i 'error' || true");
      expect(mockSSHExecutor).toHaveBeenCalledWith("docker logs --tail 50 app3 2>&1 | grep -i 'error' || true");

      expect(result.content[0].text).toContain('Log Search Results for "error"');
      expect(result.content[0].text).toContain('found in 2 of 3 containers');
      expect(result.content[0].text).toContain('=== app1 ===');
      expect(result.content[0].text).toContain('connection timeout');
      expect(result.content[0].text).toContain('=== app3 ===');
      expect(result.content[0].text).toContain('database connection failed');
    });

    it('should use default tail value of 100', async () => {
      mockSSHExecutor.mockResolvedValueOnce('test-container');
      mockSSHExecutor.mockResolvedValueOnce('some log output');

      const tool = registeredTools.get('docker logs aggregate');
      await tool.handler({ pattern: 'test' });

      expect(mockSSHExecutor).toHaveBeenCalledWith("docker logs --tail 100 test-container 2>&1 | grep -i 'test' || true");
    });

    it('should handle no running containers', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker logs aggregate');
      const result = await tool.handler({ pattern: 'error' });

      expect(result.content[0].text).toBe('No running containers found.');
    });

    it('should handle no matches found', async () => {
      mockSSHExecutor.mockResolvedValueOnce('app1\napp2');
      mockSSHExecutor.mockResolvedValueOnce(''); // app1 - no matches
      mockSSHExecutor.mockResolvedValueOnce(''); // app2 - no matches

      const tool = registeredTools.get('docker logs aggregate');
      const result = await tool.handler({ pattern: 'nonexistent-pattern', tail: 10 });

      expect(result.content[0].text).toContain('No matches found for pattern "nonexistent-pattern"');
      expect(result.content[0].text).toContain('searched 2 containers');
    });

    it('should skip containers that error during log retrieval', async () => {
      mockSSHExecutor.mockResolvedValueOnce('app1\napp2');
      mockSSHExecutor.mockRejectedValueOnce(new Error('Permission denied')); // app1 errors
      mockSSHExecutor.mockResolvedValueOnce('Found error message'); // app2 succeeds

      const tool = registeredTools.get('docker logs aggregate');
      const result = await tool.handler({ pattern: 'error' });

      expect(result.content[0].text).toContain('found in 1 of 2 containers');
      expect(result.content[0].text).toContain('=== app2 ===');
      expect(result.content[0].text).toContain('Found error message');
    });

    it('should handle errors in getting container list', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker not responding'));

      const tool = registeredTools.get('docker logs aggregate');
      const result = await tool.handler({ pattern: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error aggregating logs');
      expect(result.content[0].text).toContain('Docker not responding');
    });
  });
});
