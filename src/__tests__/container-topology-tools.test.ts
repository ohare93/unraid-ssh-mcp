import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerContainerTopologyTools } from '../tools/core/container-topology-tools.js';

describe('Container Topology Tools', () => {
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
    registerContainerTopologyTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 5 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('container_topology')).toBe(true);
    });
  });

  describe('action=network_topology', () => {
    it('should show network topology', async () => {
      mockSSHExecutor.mockResolvedValue('[{"Id":"abc123","Name":"/container1","NetworkSettings":{"Networks":{"bridge":{"IPAddress":"172.17.0.2"}}},"Mounts":[],"Config":{},"HostConfig":{}}]');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_topology' });
      expect(result.content[0].text).toContain('Network Topology');
    });
  });

  describe('action=volume_sharing', () => {
    it('should find shared volumes', async () => {
      mockSSHExecutor.mockResolvedValue('[{"Id":"abc123","Name":"/container1","NetworkSettings":{"Networks":{}},"Mounts":[],"Config":{},"HostConfig":{}}]');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'volume_sharing' });
      expect(result.content[0].text).toContain('Volume Sharing');
    });
  });

  describe('action=dependency_graph', () => {
    it('should show container dependencies', async () => {
      mockSSHExecutor.mockResolvedValue('[{"Id":"abc123","Name":"/container1","NetworkSettings":{"Networks":{}},"Mounts":[],"Config":{},"HostConfig":{}}]');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'dependency_graph' });
      expect(result.content[0].text).toContain('Dependency Graph');
    });
  });

  describe('action=port_conflicts', () => {
    it('should check for port conflicts', async () => {
      mockSSHExecutor.mockResolvedValue('[{"Id":"abc123","Name":"/container1","NetworkSettings":{"Networks":{},"Ports":{}},"Mounts":[],"Config":{},"HostConfig":{}}]');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'port_conflicts' });
      expect(result.content[0].text).toContain('Port Conflicts');
    });
  });

  describe('action=network_test', () => {
    it('should require type and host', async () => {
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_test', type: 'ping' });
      expect(result.isError).toBe(true);
    });

    it('should run ping test', async () => {
      mockSSHExecutor.mockResolvedValue('64 bytes from 8.8.8.8');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_test', type: 'ping', host: '8.8.8.8' });
      expect(result.content[0].text).toContain('Ping');
    });

    it('should run dns test', async () => {
      mockSSHExecutor.mockResolvedValue('Address: 8.8.8.8');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_test', type: 'dns', host: 'google.com' });
      expect(result.content[0].text).toContain('DNS');
    });

    it('should run traceroute test', async () => {
      mockSSHExecutor.mockResolvedValue('1 router 1ms');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_test', type: 'traceroute', host: '8.8.8.8' });
      expect(result.content[0].text).toContain('Traceroute');
    });

    it('should run container connectivity test', async () => {
      mockSSHExecutor.mockResolvedValue('Connection successful');
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_test', type: 'container', host: 'db', fromContainer: 'web', port: 5432 });
      expect(result.content[0].text).toContain('Container');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('container_topology');
      const result = await tool.handler({ action: 'network_topology' });
      expect(result.isError).toBe(true);
    });
  });
});
