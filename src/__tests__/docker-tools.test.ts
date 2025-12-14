import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDockerTools } from '../tools/core/docker-tools.js';

describe('Docker Tools', () => {
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
    registerDockerTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 14 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('docker')).toBe(true);
    });
  });

  describe('action=list_containers', () => {
    it('should list all containers', async () => {
      mockSSHExecutor.mockResolvedValue('{"Names":"test","State":"running"}');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'list_containers', all: true });
      expect(mockSSHExecutor).toHaveBeenCalledWith('docker ps -a --format json');
      expect(result.content[0].text).toContain('Containers');
    });

    it('should list running only', async () => {
      mockSSHExecutor.mockResolvedValue('{"Names":"test"}');
      const tool = registeredTools.get('docker');
      await tool.handler({ action: 'list_containers', all: false });
      expect(mockSSHExecutor).toHaveBeenCalledWith('docker ps --format json');
    });
  });

  describe('action=inspect', () => {
    it('should require container param', async () => {
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'inspect' });
      expect(result.isError).toBe(true);
    });

    it('should inspect container', async () => {
      mockSSHExecutor.mockResolvedValue('[{"Name": "/test"}]');
      const tool = registeredTools.get('docker');
      await tool.handler({ action: 'inspect', container: 'test' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('docker inspect test');
    });
  });

  describe('action=logs', () => {
    it('should require container param', async () => {
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'logs' });
      expect(result.isError).toBe(true);
    });

    it('should get container logs', async () => {
      mockSSHExecutor.mockResolvedValue('log line 1\nlog line 2');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'logs', container: 'test', dockerTail: 100 });
      expect(mockSSHExecutor).toHaveBeenCalledWith('docker logs test --tail 100 2>&1');
    });
  });

  describe('action=stats', () => {
    it('should get stats for all containers', async () => {
      mockSSHExecutor.mockResolvedValue('{"Name":"test","CPUPerc":"5%"}');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'stats' });
      expect(result.content[0].text).toContain('Stats');
    });

    it('should get stats for specific container', async () => {
      mockSSHExecutor.mockResolvedValue('CONTAINER CPU');
      const tool = registeredTools.get('docker');
      await tool.handler({ action: 'stats', container: 'test' });
      expect(mockSSHExecutor).toHaveBeenCalledWith('docker stats --no-stream test');
    });
  });

  describe('action=port', () => {
    it('should require container param', async () => {
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'port' });
      expect(result.isError).toBe(true);
    });

    it('should get port mappings', async () => {
      mockSSHExecutor.mockResolvedValue('80/tcp -> 0.0.0.0:8080');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'port', container: 'test' });
      expect(result.content[0].text).toContain('Port');
    });
  });

  describe('action=env', () => {
    it('should require container param', async () => {
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'env' });
      expect(result.isError).toBe(true);
    });

    it('should get env vars', async () => {
      mockSSHExecutor.mockResolvedValue('VAR=value');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'env', container: 'test' });
      expect(result.content[0].text).toContain('Env');
    });
  });

  describe('action=list_networks', () => {
    it('should list networks', async () => {
      mockSSHExecutor.mockResolvedValue('{"Name":"bridge"}');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'list_networks' });
      expect(result.content[0].text).toContain('Networks');
    });
  });

  describe('action=list_volumes', () => {
    it('should list volumes', async () => {
      mockSSHExecutor.mockResolvedValue('{"Name":"vol1"}');
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'list_volumes' });
      expect(result.content[0].text).toContain('Volumes');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker not running'));
      const tool = registeredTools.get('docker');
      const result = await tool.handler({ action: 'list_containers' });
      expect(result.isError).toBe(true);
    });
  });
});
