import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerResourceManagementTools } from '../resource-management-tools.js';

describe('Resource Management Tools', () => {
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
    registerResourceManagementTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 6 resource management tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(6);
      expect(registeredTools.has('resource find dangling resources')).toBe(true);
      expect(registeredTools.has('resource find resource hogs')).toBe(true);
      expect(registeredTools.has('resource disk space analyzer')).toBe(true);
      expect(registeredTools.has('resource docker system df')).toBe(true);
      expect(registeredTools.has('resource find zombie processes')).toBe(true);
      expect(registeredTools.has('resource container io profile')).toBe(true);
    });
  });

  describe('resource find dangling resources', () => {
    it('should find dangling volumes, networks, and images', async () => {
      // Mock responses for different commands
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('volume ls -f dangling=true')) {
          return '{"Name":"vol1","Driver":"local"}\n{"Name":"vol2","Driver":"local"}';
        }
        if (cmd.includes('docker system df -v')) {
          return JSON.stringify({
            Volumes: [
              { Name: 'vol1', Size: '1.2GB' },
              { Name: 'vol2', Size: '500MB' },
            ],
          });
        }
        if (cmd.includes('images -f dangling=true')) {
          return '{"ID":"abc123","CreatedSince":"2 days ago","Size":"1073741824"}';
        }
        if (cmd.includes('network ls')) {
          return '{"Name":"bridge","ID":"net1","Driver":"bridge","Scope":"local"}\n{"Name":"custom-net","ID":"net2","Driver":"bridge","Scope":"local"}';
        }
        if (cmd.includes('network inspect custom-net')) {
          return JSON.stringify([{ Containers: {} }]);
        }
        if (cmd.includes('network inspect bridge')) {
          return JSON.stringify([{ Containers: { cont1: {} } }]);
        }
        return '';
      });

      const tool = registeredTools.get('resource find dangling resources');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('DANGLING DOCKER RESOURCES');
      expect(result.content[0].text).toContain('DANGLING VOLUMES (2)');
      expect(result.content[0].text).toContain('vol1');
      expect(result.content[0].text).toContain('vol2');
      expect(result.content[0].text).toContain('DANGLING IMAGES');
      expect(result.content[0].text).toContain('abc123');
      expect(result.content[0].text).toContain('UNUSED NETWORKS');
      expect(result.content[0].text).toContain('custom-net');
    });

    it('should handle no dangling resources', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('network ls')) {
          return '{"Name":"bridge","ID":"net1","Driver":"bridge","Scope":"local"}';
        }
        if (cmd.includes('network inspect')) {
          return JSON.stringify([{ Containers: { cont1: {} } }]);
        }
        if (cmd.includes('docker system df -v')) {
          return JSON.stringify({ Volumes: [] });
        }
        return '';
      });

      const tool = registeredTools.get('resource find dangling resources');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No dangling volumes found');
      expect(result.content[0].text).toContain('No dangling images found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker daemon not running'));

      const tool = registeredTools.get('resource find dangling resources');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error finding dangling resources');
    });
  });

  describe('resource find resource hogs', () => {
    it('should find top CPU consumers by default', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps aux --sort=-%cpu')) {
          return 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot       123 50.0  2.0 100000 10000 ?        R    10:00   1:00 process1\nroot       456 25.0  1.0 50000  5000  ?        S    10:00   0:30 process2';
        }
        if (cmd.includes('docker stats')) {
          return 'NAME       CPU %    MEM %    MEM USAGE\ncontainer1 10.5%    5.2%     100MiB / 2GiB\ncontainer2 2.3%     1.1%     50MiB / 2GiB';
        }
        return '';
      });

      const tool = registeredTools.get('resource find resource hogs');
      const result = await tool.handler({ sortBy: 'cpu', limit: 10 });

      expect(result.content[0].text).toContain('TOP 10 RESOURCE CONSUMERS');
      expect(result.content[0].text).toContain('sorted by CPU');
      expect(result.content[0].text).toContain('SYSTEM PROCESSES');
      expect(result.content[0].text).toContain('process1');
      expect(result.content[0].text).toContain('DOCKER CONTAINERS');
      expect(result.content[0].text).toContain('container1');
    });

    it('should find top memory consumers', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('ps aux --sort=-%mem')) {
          return 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot       789 10.0 50.0 1000000 500000 ?      S    10:00   2:00 memory-hog';
        }
        if (cmd.includes('docker stats')) {
          return 'NAME       MEM USAGE       MEM %    CPU %\ndb         1.5GiB / 4GiB   37.5%    5.0%';
        }
        return '';
      });

      const tool = registeredTools.get('resource find resource hogs');
      const result = await tool.handler({ sortBy: 'memory', limit: 5 });

      expect(result.content[0].text).toContain('TOP 5 RESOURCE CONSUMERS');
      expect(result.content[0].text).toContain('sorted by MEMORY');
      expect(result.content[0].text).toContain('memory-hog');
      expect(result.content[0].text).toContain('db');
    });

    it('should find I/O statistics', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('iostat')) {
          return 'Device  r/s   w/s   rkB/s   wkB/s\nsda     10.0  20.0  1000    2000';
        }
        if (cmd.includes('docker stats')) {
          return 'NAME       BLOCK I/O         NET I/O\napp        100MB / 50MB     1MB / 2MB';
        }
        return '';
      });

      const tool = registeredTools.get('resource find resource hogs');
      const result = await tool.handler({ sortBy: 'io', limit: 10 });

      expect(result.content[0].text).toContain('I/O STATISTICS');
      expect(result.content[0].text).toContain('DISK I/O');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Command failed'));

      const tool = registeredTools.get('resource find resource hogs');
      const result = await tool.handler({ sortBy: 'cpu', limit: 10 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error finding resource hogs');
    });
  });

  describe('resource disk space analyzer', () => {
    it('should analyze disk space with default settings', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('du -h')) {
          return '100G\t/mnt/user/data\n50G\t/mnt/user/media\n25G\t/mnt/user/backups';
        }
        if (cmd.includes('find') && cmd.includes('-size')) {
          return '10G\t/mnt/user/data/large-file.bin\n5G\t/mnt/user/media/movie.mkv';
        }
        if (cmd.includes('df -h')) {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       1.0T  500G  500G  50% /mnt/user';
        }
        return '';
      });

      const tool = registeredTools.get('resource disk space analyzer');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('DISK SPACE ANALYSIS: /mnt/user');
      expect(result.content[0].text).toContain('LARGEST DIRECTORIES');
      expect(result.content[0].text).toContain('100G');
      expect(result.content[0].text).toContain('LARGEST FILES');
      expect(result.content[0].text).toContain('large-file.bin');
      expect(result.content[0].text).toContain('FILESYSTEM USAGE');
    });

    it('should analyze custom path with custom depth and size', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('/custom/path')) {
          return '200G\t/custom/path';
        }
        if (cmd.includes('--max-depth=3')) {
          return '200G\t/custom/path';
        }
        if (cmd.includes('-size +100M')) {
          return '150M\t/custom/path/file.dat';
        }
        if (cmd.includes('df -h')) {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sdb1       2.0T  1.5T  500G  75% /custom/path';
        }
        return '';
      });

      const tool = registeredTools.get('resource disk space analyzer');
      const result = await tool.handler({
        path: '/custom/path',
        depth: 3,
        minSize: '100M',
      });

      expect(result.content[0].text).toContain('DISK SPACE ANALYSIS: /custom/path');
      expect(result.content[0].text).toContain('max depth 3');
      expect(result.content[0].text).toContain('minimum 100M');
    });

    it('should handle no large files found', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('du -h')) {
          return '10G\t/mnt/user';
        }
        if (cmd.includes('find')) {
          return '';
        }
        if (cmd.includes('df -h')) {
          return 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1       1.0T  10G  990G   1% /mnt/user';
        }
        return '';
      });

      const tool = registeredTools.get('resource disk space analyzer');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No files larger than 1G found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('resource disk space analyzer');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error analyzing disk space');
    });
  });

  describe('resource docker system df', () => {
    it('should show Docker disk usage breakdown', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd === 'docker system df -v') {
          return 'Images space usage:\nIMAGE         CREATED     SIZE\nnginx:latest  2 days ago  142MB\n\nContainers space usage:\nCONTAINER ID  IMAGE    SIZE\nabc123        nginx    10MB';
        }
        if (cmd === 'docker system df --format json') {
          return JSON.stringify({
            Images: [
              {
                TotalCount: 10,
                Active: 5,
                Size: '2.5GB',
                Reclaimable: '1.2GB',
              },
            ],
            Containers: [
              {
                TotalCount: 8,
                Active: 6,
                Size: '500MB',
                Reclaimable: '100MB',
              },
            ],
            Volumes: [
              {
                TotalCount: 15,
                Active: 12,
                Size: '10GB',
                Reclaimable: '3GB',
              },
            ],
            BuildCache: [
              {
                Size: '1.5GB',
                Reclaimable: '1.5GB',
              },
            ],
          });
        }
        return '';
      });

      const tool = registeredTools.get('resource docker system df');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('DOCKER SYSTEM DISK USAGE');
      expect(result.content[0].text).toContain('Images:');
      expect(result.content[0].text).toContain('Containers:');
      expect(result.content[0].text).toContain('Volumes:');
      expect(result.content[0].text).toContain('Build Cache:');
      expect(result.content[0].text).toContain('10 total');
      expect(result.content[0].text).toContain('Reclaimable');
    });

    it('should handle Docker not running', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Cannot connect to Docker daemon'));

      const tool = registeredTools.get('resource docker system df');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting Docker disk usage');
    });
  });

  describe('resource find zombie processes', () => {
    it('should find zombie processes', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('$8=="Z"')) {
          return 'root       999  0.0  0.0     0     0 ?        Z    10:00   0:00 [defunct]\nroot      1000  0.0  0.0     0     0 ?        Z    10:05   0:00 [zombie-proc]';
        }
        if (cmd.includes('ps -o ppid=')) {
          return '123';
        }
        if (cmd.includes('ps -p 123')) {
          return 'PID  PPID STAT COMMAND\n123     1 S    parent-process';
        }
        if (cmd.includes('$8=="D"')) {
          return '';
        }
        if (cmd === 'uptime') {
          return ' 10:30:00 up 5 days, 12:34,  2 users,  load average: 0.50, 0.75, 1.00';
        }
        return '';
      });

      const tool = registeredTools.get('resource find zombie processes');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('ZOMBIE AND STUCK PROCESSES');
      expect(result.content[0].text).toContain('ZOMBIE PROCESSES');
      expect(result.content[0].text).toContain('defunct');
      expect(result.content[0].text).toContain('PARENT PROCESSES');
      expect(result.content[0].text).toContain('parent-process');
      expect(result.content[0].text).toContain('SYSTEM LOAD AVERAGE');
      expect(result.content[0].text).toContain('load average');
    });

    it('should find processes in uninterruptible sleep', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('$8=="Z"')) {
          return '';
        }
        if (cmd.includes('$8=="D"')) {
          return 'root      2000  5.0  1.0 100000 10000 ?        D    10:00  10:00 stuck-io';
        }
        if (cmd === 'uptime') {
          return ' 10:30:00 up 5 days, 12:34,  2 users,  load average: 5.50, 4.75, 3.00';
        }
        return '';
      });

      const tool = registeredTools.get('resource find zombie processes');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No zombie processes found');
      expect(result.content[0].text).toContain('UNINTERRUPTIBLE SLEEP');
      expect(result.content[0].text).toContain('stuck-io');
    });

    it('should handle no zombie or stuck processes', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('$8=="Z"') || cmd.includes('$8=="D"')) {
          return '';
        }
        if (cmd === 'uptime') {
          return ' 10:30:00 up 5 days, 12:34,  2 users,  load average: 0.10, 0.15, 0.20';
        }
        return '';
      });

      const tool = registeredTools.get('resource find zombie processes');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No zombie processes found');
      expect(result.content[0].text).toContain('No processes in uninterruptible sleep');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('ps command failed'));

      const tool = registeredTools.get('resource find zombie processes');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error finding zombie processes');
    });
  });

  describe('resource container io profile', () => {
    it('should profile container I/O with default duration', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker stats --no-stream')) {
          return 'NAME       BLOCK I/O         NET I/O       CPU %    MEM %\napp1       100MB / 50MB     10MB / 5MB    10.5%    5.2%\napp2       200MB / 100MB    20MB / 10MB   5.3%     3.1%';
        }
        if (cmd.includes('docker ps --format json')) {
          return '{"Names":"app1","ID":"abc123"}\n{"Names":"app2","ID":"def456"}';
        }
        if (cmd.includes('docker exec') && cmd.includes('blkio')) {
          return '8:0 Read 104857600\n8:0 Write 52428800';
        }
        if (cmd.includes('iostat')) {
          return 'Device  r/s   w/s   rkB/s   wkB/s\nsda     50.0  100.0  5000   10000';
        }
        return '';
      });

      const tool = registeredTools.get('resource container io profile');
      const result = await tool.handler({ duration: 5 });

      expect(result.content[0].text).toContain('CONTAINER I/O PROFILE (5s sampling)');
      expect(result.content[0].text).toContain('CONTAINER I/O STATISTICS');
      expect(result.content[0].text).toContain('BLOCK I/O');
      expect(result.content[0].text).toContain('DETAILED CONTAINER INFO');
      expect(result.content[0].text).toContain('Container: app1');
      expect(result.content[0].text).toContain('SYSTEM I/O OVERVIEW');
    });

    it('should handle custom duration', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('timeout 11')) {
          return 'NAME       BLOCK I/O\napp        500MB / 250MB';
        }
        if (cmd.includes('docker ps --format json')) {
          return '{"Names":"app","ID":"abc123"}';
        }
        if (cmd.includes('docker exec')) {
          return 'N/A';
        }
        if (cmd.includes('iostat')) {
          return 'Device  r/s   w/s\nsda     100.0 200.0';
        }
        return '';
      });

      const tool = registeredTools.get('resource container io profile');
      const result = await tool.handler({ duration: 10 });

      expect(result.content[0].text).toContain('10s sampling');
      expect(mockSSHExecutor).toHaveBeenCalledWith(expect.stringContaining('timeout 11'));
    });

    it('should handle containers without cgroup access', async () => {
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker stats')) {
          return 'NAME    BLOCK I/O\napp     10MB / 5MB';
        }
        if (cmd.includes('docker ps --format json')) {
          return '{"Names":"app","ID":"abc123"}';
        }
        if (cmd.includes('docker exec')) {
          return 'N/A';
        }
        if (cmd.includes('iostat')) {
          return 'iostat not available';
        }
        return '';
      });

      const tool = registeredTools.get('resource container io profile');
      const result = await tool.handler({ duration: 5 });

      expect(result.content[0].text).toContain('CONTAINER I/O PROFILE');
      expect(result.content[0].text).toContain("doesn't support cgroup access");
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Docker stats failed'));

      const tool = registeredTools.get('resource container io profile');
      const result = await tool.handler({ duration: 5 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error profiling container I/O');
    });
  });
});
