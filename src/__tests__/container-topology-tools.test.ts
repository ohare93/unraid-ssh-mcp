import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerContainerTopologyTools } from '../container-topology-tools.js';

describe('Container Topology Tools', () => {
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
    registerContainerTopologyTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 8 container topology tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(8);
      expect(registeredTools.has('container network topology')).toBe(true);
      expect(registeredTools.has('container volume sharing')).toBe(true);
      expect(registeredTools.has('container dependency graph')).toBe(true);
      expect(registeredTools.has('container port conflict check')).toBe(true);
      expect(registeredTools.has('container communication test')).toBe(true);
      expect(registeredTools.has('container dns test')).toBe(true);
      expect(registeredTools.has('container ping test')).toBe(true);
      expect(registeredTools.has('container traceroute test')).toBe(true);
    });
  });

  describe('container network topology', () => {
    it('should analyze network topology for multiple containers', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123def456',
          Name: '/web-server',
          NetworkSettings: {
            Networks: {
              bridge: {
                IPAddress: '172.17.0.2',
                Gateway: '172.17.0.1',
                MacAddress: '02:42:ac:11:00:02',
              },
            },
          },
          HostConfig: {
            NetworkMode: 'bridge',
          },
          Mounts: [],
        },
        {
          Id: 'def456ghi789',
          Name: '/database',
          NetworkSettings: {
            Networks: {
              bridge: {
                IPAddress: '172.17.0.3',
                Gateway: '172.17.0.1',
                MacAddress: '02:42:ac:11:00:03',
              },
            },
          },
          HostConfig: {
            NetworkMode: 'bridge',
          },
          Mounts: [],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container network topology');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker inspect $(docker ps -q)');
      expect(result.content[0].text).toContain('Container Network Topology');
      expect(result.content[0].text).toContain('Network: bridge');
      expect(result.content[0].text).toContain('web-server');
      expect(result.content[0].text).toContain('172.17.0.2');
      expect(result.content[0].text).toContain('database');
      expect(result.content[0].text).toContain('172.17.0.3');
    });

    it('should handle containers without networks', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123def456',
          Name: '/isolated',
          NetworkSettings: {
            Networks: {},
          },
          HostConfig: {
            NetworkMode: 'none',
          },
          Mounts: [],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container network topology');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Containers without network');
      expect(result.content[0].text).toContain('isolated');
    });

    it('should handle no running containers', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('container network topology');
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('No running containers found.');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker daemon not running'));

      const tool = registeredTools.get('container network topology');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error analyzing network topology');
    });
  });

  describe('container volume sharing', () => {
    it('should identify shared volumes', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app1',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [
            { Type: 'volume', Name: 'shared-data', Source: '/var/lib/docker/volumes/shared-data' },
            { Type: 'volume', Name: 'app1-data', Source: '/var/lib/docker/volumes/app1-data' },
          ],
        },
        {
          Id: 'def456',
          Name: '/app2',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [
            { Type: 'volume', Name: 'shared-data', Source: '/var/lib/docker/volumes/shared-data' },
          ],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container volume sharing');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker inspect $(docker ps -aq)');
      expect(result.content[0].text).toContain('Container Volume Sharing Analysis');
      expect(result.content[0].text).toContain('Shared Volumes (1)');
      expect(result.content[0].text).toContain('shared-data');
      expect(result.content[0].text).toContain('app1');
      expect(result.content[0].text).toContain('app2');
    });

    it('should handle bind mounts', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [
            { Type: 'bind', Source: '/host/data', Destination: '/container/data' },
          ],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container volume sharing');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('/host/data');
    });

    it('should handle no shared volumes', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app1',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [{ Type: 'volume', Name: 'vol1' }],
        },
        {
          Id: 'def456',
          Name: '/app2',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [{ Type: 'volume', Name: 'vol2' }],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container volume sharing');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No shared volumes found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('container volume sharing');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error analyzing volume sharing');
    });
  });

  describe('container dependency graph', () => {
    it('should show container dependencies', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/web',
          NetworkSettings: { Networks: {} },
          HostConfig: {
            NetworkMode: 'bridge',
            Links: ['/database:/web/db'],
          },
          Mounts: [],
          Config: {
            Labels: {
              'com.docker.compose.depends_on': '{"database":{"condition":"service_started"}}',
            },
          },
        },
        {
          Id: 'def456',
          Name: '/database',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
          Config: { Labels: {} },
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container dependency graph');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker inspect $(docker ps -aq)');
      expect(result.content[0].text).toContain('Container Dependency Graph');
      expect(result.content[0].text).toContain('web');
      expect(result.content[0].text).toContain('Depends on');
      expect(result.content[0].text).toContain('database');
    });

    it('should filter by specific container', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/web',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
          Config: { Labels: {} },
        },
        {
          Id: 'def456',
          Name: '/database',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
          Config: { Labels: {} },
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container dependency graph');
      const result = await tool.handler({ container: 'web' });

      expect(result.content[0].text).toContain('Container: web');
      expect(result.content[0].text).not.toContain('Container: database');
    });

    it('should show network_mode container dependencies', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'container:nginx' },
          Mounts: [],
          Config: { Labels: {} },
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container dependency graph');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Uses network of');
      expect(result.content[0].text).toContain('nginx');
    });

    it('should handle container not found', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/web',
          NetworkSettings: { Networks: {} },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
          Config: { Labels: {} },
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container dependency graph');
      const result = await tool.handler({ container: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Container "nonexistent" not found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Connection timeout'));

      const tool = registeredTools.get('container dependency graph');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error analyzing dependencies');
    });
  });

  describe('container port conflict check', () => {
    it('should detect port conflicts', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app1',
          NetworkSettings: {
            Networks: {},
            Ports: {
              '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
            },
          },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
        },
        {
          Id: 'def456',
          Name: '/app2',
          NetworkSettings: {
            Networks: {},
            Ports: {
              '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
            },
          },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container port conflict check');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker inspect $(docker ps -aq)');
      expect(result.content[0].text).toContain('Port Conflict Analysis');
      expect(result.content[0].text).toContain('CONFLICTS DETECTED');
      expect(result.content[0].text).toContain('0.0.0.0:8080');
      expect(result.content[0].text).toContain('app1');
      expect(result.content[0].text).toContain('app2');
    });

    it('should handle no conflicts', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app1',
          NetworkSettings: {
            Networks: {},
            Ports: {
              '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
            },
          },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
        },
        {
          Id: 'def456',
          Name: '/app2',
          NetworkSettings: {
            Networks: {},
            Ports: {
              '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8081' }],
            },
          },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container port conflict check');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No port conflicts detected');
    });

    it('should handle unmapped ports', async () => {
      const mockInspect = JSON.stringify([
        {
          Id: 'abc123',
          Name: '/app',
          NetworkSettings: {
            Networks: {},
            Ports: {
              '80/tcp': null,
            },
          },
          HostConfig: { NetworkMode: 'bridge' },
          Mounts: [],
        },
      ]);

      mockSSHExecutor.mockResolvedValue(mockInspect);

      const tool = registeredTools.get('container port conflict check');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('not mapped');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker error'));

      const tool = registeredTools.get('container port conflict check');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error checking port conflicts');
    });
  });

  describe('container communication test', () => {
    it('should test communication with ping', async () => {
      mockSSHExecutor.mockResolvedValue('4 packets transmitted, 4 received, 0% packet loss');

      const tool = registeredTools.get('container communication test');
      const result = await tool.handler({ fromContainer: 'app1', toContainer: 'app2' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('docker exec app1 ping -c 4 app2');
      expect(result.content[0].text).toContain('Container Communication Test');
      expect(result.content[0].text).toContain('From: app1');
      expect(result.content[0].text).toContain('To: app2');
      expect(result.content[0].text).toContain('SUCCESS');
    });

    it('should test communication with netcat when port specified', async () => {
      mockSSHExecutor.mockResolvedValue('Connection to app2 80 port [tcp/http] succeeded!');

      const tool = registeredTools.get('container communication test');
      const result = await tool.handler({ fromContainer: 'app1', toContainer: 'app2', port: 80 });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        'docker exec app1 sh -c "command -v nc >/dev/null 2>&1 && nc -zv app2 80 2>&1 || echo \'netcat not available in container\'"'
      );
      expect(result.content[0].text).toContain('Port: 80');
      expect(result.content[0].text).toContain('SUCCESS');
    });

    it('should handle netcat not available', async () => {
      mockSSHExecutor.mockResolvedValue('netcat not available in container');

      const tool = registeredTools.get('container communication test');
      const result = await tool.handler({ fromContainer: 'app1', toContainer: 'app2', port: 80 });

      expect(result.content[0].text).toContain('UNKNOWN');
      expect(result.content[0].text).toContain('netcat not available');
    });

    it('should handle failed ping', async () => {
      mockSSHExecutor.mockResolvedValue('0 packets transmitted, 0 received, 100% packet loss');

      const tool = registeredTools.get('container communication test');
      const result = await tool.handler({ fromContainer: 'app1', toContainer: 'app2' });

      expect(result.content[0].text).toContain('FAILED');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Container not found'));

      const tool = registeredTools.get('container communication test');
      const result = await tool.handler({ fromContainer: 'app1', toContainer: 'app2' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error testing communication');
    });
  });

  describe('container dns test', () => {
    it('should test DNS resolution with nslookup', async () => {
      mockSSHExecutor.mockResolvedValue(`Server:    127.0.0.11
Address:   127.0.0.11#53

Non-authoritative answer:
Name:      google.com
Address:   142.250.185.78`);

      const tool = registeredTools.get('container dns test');
      const result = await tool.handler({ hostname: 'google.com' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('nslookup google.com');
      expect(result.content[0].text).toContain('DNS Resolution Test');
      expect(result.content[0].text).toContain('Hostname: google.com');
      expect(result.content[0].text).toContain('nslookup Result');
    });

    it('should test DNS resolution with custom DNS server', async () => {
      mockSSHExecutor.mockResolvedValue('Name:      example.com\nAddress:   93.184.216.34');

      const tool = registeredTools.get('container dns test');
      const result = await tool.handler({ hostname: 'example.com', dnsServer: '8.8.8.8' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('nslookup example.com 8.8.8.8');
      expect(result.content[0].text).toContain('DNS Server: 8.8.8.8');
    });

    it('should fallback to dig if nslookup fails', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('nslookup not found'))
        .mockResolvedValueOnce('example.com.  300  IN  A  93.184.216.34');

      const tool = registeredTools.get('container dns test');
      const result = await tool.handler({ hostname: 'example.com' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('nslookup example.com');
      expect(mockSSHExecutor).toHaveBeenCalledWith('dig example.com');
      expect(result.content[0].text).toContain('dig Result');
    });

    it('should handle errors when both tools fail', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('nslookup failed'))
        .mockRejectedValueOnce(new Error('dig failed'));

      const tool = registeredTools.get('container dns test');
      const result = await tool.handler({ hostname: 'invalid.domain' });

      expect(result.content[0].text).toContain('Both nslookup and dig failed');
      expect(result.content[0].text).toContain('nslookup error');
      expect(result.content[0].text).toContain('dig error');
    });
  });

  describe('container ping test', () => {
    it('should test connectivity with default count', async () => {
      mockSSHExecutor.mockResolvedValue(`PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=10.2 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=10.3 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=10.1 ms
64 bytes from 8.8.8.8: icmp_seq=4 ttl=118 time=10.4 ms`);

      const tool = registeredTools.get('container ping test');
      const result = await tool.handler({ host: '8.8.8.8' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('ping -c 4 8.8.8.8');
      expect(result.content[0].text).toContain('Ping Test');
      expect(result.content[0].text).toContain('Host: 8.8.8.8');
      expect(result.content[0].text).toContain('Packets: 4');
    });

    it('should test connectivity with custom count', async () => {
      mockSSHExecutor.mockResolvedValue('PING output');

      const tool = registeredTools.get('container ping test');
      await tool.handler({ host: 'example.com', count: 10 });

      expect(mockSSHExecutor).toHaveBeenCalledWith('ping -c 10 example.com');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Network unreachable'));

      const tool = registeredTools.get('container ping test');
      const result = await tool.handler({ host: '192.168.1.1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error pinging host');
    });
  });

  describe('container traceroute test', () => {
    it('should trace route with traceroute', async () => {
      mockSSHExecutor.mockResolvedValue(`traceroute to google.com (142.250.185.78), 30 hops max, 60 byte packets
 1  192.168.1.1 (192.168.1.1)  1.234 ms  1.123 ms  1.345 ms
 2  10.0.0.1 (10.0.0.1)  5.678 ms  5.890 ms  5.432 ms`);

      const tool = registeredTools.get('container traceroute test');
      const result = await tool.handler({ host: 'google.com' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('traceroute google.com');
      expect(result.content[0].text).toContain('Traceroute Test');
      expect(result.content[0].text).toContain('Host: google.com');
      expect(result.content[0].text).toContain('traceroute Result');
    });

    it('should fallback to tracepath if traceroute fails', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('traceroute not found'))
        .mockResolvedValueOnce(' 1:  router  1.234ms');

      const tool = registeredTools.get('container traceroute test');
      const result = await tool.handler({ host: 'example.com' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('traceroute example.com');
      expect(mockSSHExecutor).toHaveBeenCalledWith('tracepath example.com');
      expect(result.content[0].text).toContain('tracepath Result');
    });

    it('should handle errors when both tools fail', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('traceroute failed'))
        .mockRejectedValueOnce(new Error('tracepath failed'));

      const tool = registeredTools.get('container traceroute test');
      const result = await tool.handler({ host: '8.8.8.8' });

      expect(result.content[0].text).toContain('Both traceroute and tracepath failed');
      expect(result.content[0].text).toContain('traceroute error');
      expect(result.content[0].text).toContain('tracepath error');
    });
  });
});
