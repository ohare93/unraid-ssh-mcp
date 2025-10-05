import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDockerTools } from '../docker-tools.js';

describe('Docker Tools', () => {
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
    registerDockerTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 5 Docker tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(5);
      expect(registeredTools.has('docker list containers')).toBe(true);
      expect(registeredTools.has('docker inspect')).toBe(true);
      expect(registeredTools.has('docker logs')).toBe(true);
      expect(registeredTools.has('docker stats snapshot')).toBe(true);
      expect(registeredTools.has('docker port')).toBe(true);
    });
  });

  describe('docker list containers', () => {
    it('should list all containers by default', async () => {
      const mockOutput = `{"ID":"abc123","Names":"container1","Image":"nginx","Status":"Up 2 hours","State":"running","Ports":"80/tcp"}
{"ID":"def456","Names":"container2","Image":"redis","Status":"Up 1 hour","State":"running","Ports":"6379/tcp"}`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker list containers');
      const result = await tool.handler({ all: true });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker ps -a --format json');
      expect(result.content[0].text).toContain('Docker Containers:');
      expect(result.content[0].text).toContain('container1');
      expect(result.content[0].text).toContain('container2');
    });

    it('should list only running containers when all=false', async () => {
      mockSSHExecutor.mockResolvedValue('{"ID":"abc123","Names":"container1","Image":"nginx","Status":"Up","State":"running","Ports":"80/tcp"}');

      const tool = registeredTools.get('docker list containers');
      await tool.handler({ all: false });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker ps --format json');
    });

    it('should handle no containers found', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker list containers');
      const result = await tool.handler({ all: true });

      expect(result.content[0].text).toBe('No containers found.');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH connection failed'));

      const tool = registeredTools.get('docker list containers');
      const result = await tool.handler({ all: true });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing containers');
      expect(result.content[0].text).toContain('SSH connection failed');
    });
  });

  describe('docker inspect', () => {
    it('should inspect a container', async () => {
      const mockInspect = JSON.stringify([{ Id: 'abc123', Name: 'test-container', State: { Running: true } }]);
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect');
      const result = await tool.handler({ container: 'test-container' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker inspect test-container');
      expect(result.content[0].text).toContain('Docker Inspect - test-container');
      expect(result.content[0].text).toContain('abc123');
    });

    it('should handle inspect errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Container not found'));

      const tool = registeredTools.get('docker inspect');
      const result = await tool.handler({ container: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting container');
    });
  });

  describe('docker logs', () => {
    it('should retrieve container logs', async () => {
      mockSSHExecutor.mockResolvedValue('Log line 1\nLog line 2\nLog line 3');

      const tool = registeredTools.get('docker logs');
      const result = await tool.handler({ container: 'my-app' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker logs my-app');
      expect(result.content[0].text).toContain('Docker Logs - my-app');
      expect(result.content[0].text).toContain('Log line 1');
    });

    it('should support dockerTail option', async () => {
      mockSSHExecutor.mockResolvedValue('Recent log');

      const tool = registeredTools.get('docker logs');
      await tool.handler({ container: 'my-app', dockerTail: 10 });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker logs my-app --tail 10');
    });

    it('should support dockerSince option', async () => {
      mockSSHExecutor.mockResolvedValue('Recent log');

      const tool = registeredTools.get('docker logs');
      await tool.handler({ container: 'my-app', dockerSince: '5m' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker logs my-app --since 5m');
    });

    it('should support both dockerTail and dockerSince options', async () => {
      mockSSHExecutor.mockResolvedValue('Filtered logs');

      const tool = registeredTools.get('docker logs');
      await tool.handler({ container: 'my-app', dockerTail: 20, dockerSince: '1h' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker logs my-app --tail 20 --since 1h');
    });

    it('should handle logs errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('docker logs');
      const result = await tool.handler({ container: 'my-app' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error retrieving logs');
    });
  });

  describe('docker stats snapshot', () => {
    it('should get stats for all containers', async () => {
      const mockStats = `CONTAINER ID   NAME       CPU %     MEM USAGE / LIMIT     MEM %     NET I/O       BLOCK I/O
abc123         nginx      0.50%     50MiB / 2GiB          2.44%     1.2kB / 0B    0B / 0B`;
      mockSSHExecutor.mockResolvedValue(mockStats);

      const tool = registeredTools.get('docker stats snapshot');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker stats --no-stream');
      expect(result.content[0].text).toContain('Docker Stats Snapshot');
      expect(result.content[0].text).toContain('nginx');
    });

    it('should get stats for specific container', async () => {
      mockSSHExecutor.mockResolvedValue('CONTAINER ID   NAME    CPU %\nabc123         redis   1.2%');

      const tool = registeredTools.get('docker stats snapshot');
      await tool.handler({ container: 'redis' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker stats --no-stream redis');
    });

    it('should handle stats errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker not running'));

      const tool = registeredTools.get('docker stats snapshot');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting stats');
    });
  });

  describe('docker port', () => {
    it('should show port mappings', async () => {
      mockSSHExecutor.mockResolvedValue('80/tcp -> 0.0.0.0:8080\n443/tcp -> 0.0.0.0:8443');

      const tool = registeredTools.get('docker port');
      const result = await tool.handler({ container: 'web-server' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker port web-server');
      expect(result.content[0].text).toContain('Docker Port Mappings - web-server');
      expect(result.content[0].text).toContain('8080');
      expect(result.content[0].text).toContain('8443');
    });

    it('should handle containers with no port mappings', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker port');
      const result = await tool.handler({ container: 'no-ports' });

      expect(result.content[0].text).toContain('No port mappings found');
    });

    it('should handle port errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Container not found'));

      const tool = registeredTools.get('docker port');
      const result = await tool.handler({ container: 'missing' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting port mappings');
    });
  });
});
