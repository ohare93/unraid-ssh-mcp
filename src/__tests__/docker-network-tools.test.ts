import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDockerNetworkTools } from '../docker-network-tools.js';

describe('Docker Network Tools', () => {
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
    registerDockerNetworkTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 5 Docker network/volume tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(5);
      expect(registeredTools.has('docker list networks')).toBe(true);
      expect(registeredTools.has('docker inspect network')).toBe(true);
      expect(registeredTools.has('docker list volumes')).toBe(true);
      expect(registeredTools.has('docker inspect volume')).toBe(true);
      expect(registeredTools.has('docker network containers')).toBe(true);
    });
  });

  describe('docker list networks', () => {
    it('should list all networks', async () => {
      const mockOutput = `NETWORK ID     NAME         DRIVER    SCOPE
abc123def      bridge       bridge    local
xyz789ghi      host         host      local
def456jkl      my-network   bridge    local`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker list networks');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker network ls');
      expect(result.content[0].text).toContain('Docker Networks');
      expect(result.content[0].text).toContain('bridge');
      expect(result.content[0].text).toContain('host');
      expect(result.content[0].text).toContain('my-network');
    });

    it('should list networks with filter', async () => {
      const mockOutput = `NETWORK ID     NAME         DRIVER    SCOPE
abc123def      bridge       bridge    local`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker list networks');
      const result = await tool.handler({ filter: 'bridge' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker network ls --filter driver=bridge');
      expect(result.content[0].text).toContain('Docker Networks');
    });

    it('should handle no networks found', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker list networks');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Docker Networks');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker daemon not running'));

      const tool = registeredTools.get('docker list networks');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing networks');
      expect(result.content[0].text).toContain('Docker daemon not running');
    });

    it('should handle non-Error exceptions', async () => {
      mockSSHExecutor.mockRejectedValue('String error');

      const tool = registeredTools.get('docker list networks');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing networks');
      expect(result.content[0].text).toContain('String error');
    });
  });

  describe('docker inspect network', () => {
    it('should inspect a network', async () => {
      const mockInspect = JSON.stringify([
        {
          Name: 'my-network',
          Id: 'abc123def456',
          Driver: 'bridge',
          Scope: 'local',
          IPAM: {
            Driver: 'default',
            Config: [{ Subnet: '172.18.0.0/16', Gateway: '172.18.0.1' }],
          },
          Containers: {},
        },
      ]);
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect network');
      const result = await tool.handler({ network: 'my-network' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker network inspect my-network');
      expect(result.content[0].text).toContain('Docker Network Inspect - my-network');
      expect(result.content[0].text).toContain('abc123def456');
      expect(result.content[0].text).toContain('bridge');
      expect(result.content[0].text).toContain('172.18.0.0/16');
    });

    it('should inspect network by ID', async () => {
      const mockInspect = JSON.stringify([{ Name: 'bridge', Id: 'xyz789' }]);
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect network');
      const result = await tool.handler({ network: 'xyz789' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker network inspect xyz789');
      expect(result.content[0].text).toContain('Docker Network Inspect - xyz789');
    });

    it('should pretty-print JSON with proper indentation', async () => {
      const mockInspect = JSON.stringify({ Name: 'test', Driver: 'bridge' });
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect network');
      const result = await tool.handler({ network: 'test' });

      // Check that the output contains properly indented JSON
      expect(result.content[0].text).toMatch(/"Name": "test"/);
      expect(result.content[0].text).toMatch(/"Driver": "bridge"/);
    });

    it('should handle inspect errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Network not found'));

      const tool = registeredTools.get('docker inspect network');
      const result = await tool.handler({ network: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting network');
      expect(result.content[0].text).toContain('Network not found');
    });

    it('should handle non-Error exceptions', async () => {
      mockSSHExecutor.mockRejectedValue('Connection timeout');

      const tool = registeredTools.get('docker inspect network');
      const result = await tool.handler({ network: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting network');
      expect(result.content[0].text).toContain('Connection timeout');
    });

    it('should handle invalid JSON response', async () => {
      mockSSHExecutor.mockResolvedValue('invalid json response');

      const tool = registeredTools.get('docker inspect network');
      const result = await tool.handler({ network: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting network');
    });
  });

  describe('docker list volumes', () => {
    it('should list all volumes', async () => {
      const mockOutput = `DRIVER    VOLUME NAME
local     vol1
local     vol2
nfs       vol3`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker list volumes');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker volume ls');
      expect(result.content[0].text).toContain('Docker Volumes');
      expect(result.content[0].text).toContain('vol1');
      expect(result.content[0].text).toContain('vol2');
      expect(result.content[0].text).toContain('vol3');
    });

    it('should list only dangling volumes', async () => {
      const mockOutput = `DRIVER    VOLUME NAME
local     orphan-vol`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker list volumes');
      const result = await tool.handler({ dangling: true });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker volume ls --filter dangling=true');
      expect(result.content[0].text).toContain('Docker Volumes');
    });

    it('should list only in-use volumes', async () => {
      const mockOutput = `DRIVER    VOLUME NAME
local     used-vol`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker list volumes');
      const result = await tool.handler({ dangling: false });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker volume ls --filter dangling=false');
      expect(result.content[0].text).toContain('Docker Volumes');
    });

    it('should handle no volumes found', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker list volumes');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Docker Volumes');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('docker list volumes');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing volumes');
      expect(result.content[0].text).toContain('Permission denied');
    });

    it('should handle non-Error exceptions', async () => {
      mockSSHExecutor.mockRejectedValue('Unexpected error');

      const tool = registeredTools.get('docker list volumes');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing volumes');
      expect(result.content[0].text).toContain('Unexpected error');
    });
  });

  describe('docker inspect volume', () => {
    it('should inspect a volume', async () => {
      const mockInspect = JSON.stringify([
        {
          Name: 'myvolume',
          Driver: 'local',
          Mountpoint: '/var/lib/docker/volumes/myvolume/_data',
          Labels: { environment: 'production' },
          Options: {},
        },
      ]);
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: 'myvolume' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker volume inspect myvolume');
      expect(result.content[0].text).toContain('Docker Volume Inspect - myvolume');
      expect(result.content[0].text).toContain('myvolume');
      expect(result.content[0].text).toContain('local');
      expect(result.content[0].text).toContain('/var/lib/docker/volumes/myvolume/_data');
      expect(result.content[0].text).toContain('production');
    });

    it('should inspect volume with complex configuration', async () => {
      const mockInspect = JSON.stringify([
        {
          Name: 'nfs-volume',
          Driver: 'nfs',
          Mountpoint: '/mnt/nfs/data',
          Labels: { type: 'shared', backup: 'enabled' },
          Options: { device: '192.168.1.100:/export', type: 'nfs' },
        },
      ]);
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: 'nfs-volume' });

      expect(result.content[0].text).toContain('nfs-volume');
      expect(result.content[0].text).toContain('192.168.1.100:/export');
    });

    it('should pretty-print JSON with proper indentation', async () => {
      const mockInspect = JSON.stringify({ Name: 'test-vol', Driver: 'local' });
      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: 'test-vol' });

      // Check that the output contains properly indented JSON
      expect(result.content[0].text).toMatch(/"Name": "test-vol"/);
      expect(result.content[0].text).toMatch(/"Driver": "local"/);
    });

    it('should handle inspect errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Volume not found'));

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting volume');
      expect(result.content[0].text).toContain('Volume not found');
    });

    it('should handle non-Error exceptions', async () => {
      mockSSHExecutor.mockRejectedValue('SSH timeout');

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting volume');
      expect(result.content[0].text).toContain('SSH timeout');
    });

    it('should handle invalid JSON response', async () => {
      mockSSHExecutor.mockResolvedValue('not a json response');

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error inspecting volume');
    });

    it('should handle empty volume name', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('invalid volume name'));

      const tool = registeredTools.get('docker inspect volume');
      const result = await tool.handler({ volume: '' });

      expect(result.isError).toBe(true);
    });
  });

  describe('docker network containers', () => {
    it('should list containers connected to a network', async () => {
      const mockOutput = `abc123: container1 (172.18.0.2/16)
def456: container2 (172.18.0.3/16)`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get('docker network containers');
      const result = await tool.handler({ network: 'my-network' });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining('docker network inspect my-network')
      );
      expect(result.content[0].text).toContain('Containers on network my-network');
      expect(result.content[0].text).toContain('container1');
      expect(result.content[0].text).toContain('172.18.0.2');
    });

    it('should handle network with no containers', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('docker network containers');
      const result = await tool.handler({ network: 'empty-network' });

      expect(result.content[0].text).toContain('No containers connected to this network');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Network not found'));

      const tool = registeredTools.get('docker network containers');
      const result = await tool.handler({ network: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting network containers');
      expect(result.content[0].text).toContain('Network not found');
    });

    it('should handle non-Error exceptions', async () => {
      mockSSHExecutor.mockRejectedValue('Connection failed');

      const tool = registeredTools.get('docker network containers');
      const result = await tool.handler({ network: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting network containers');
      expect(result.content[0].text).toContain('Connection failed');
    });
  });
});
