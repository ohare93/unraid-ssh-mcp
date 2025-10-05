import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHealthDiagnosticsTools } from '../health-diagnostics-tools.js';

describe('Health Diagnostics Tools', () => {
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
    registerHealthDiagnosticsTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 6 health diagnostics tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(6);
      expect(registeredTools.has('health check comprehensive')).toBe(true);
      expect(registeredTools.has('health detect common issues')).toBe(true);
      expect(registeredTools.has('health threshold alerts')).toBe(true);
      expect(registeredTools.has('health compare baseline')).toBe(true);
      expect(registeredTools.has('health generate diagnostic report')).toBe(true);
      expect(registeredTools.has('health snapshot system state')).toBe(true);
    });
  });

  describe('health check comprehensive', () => {
    it('should return OK status when all systems healthy', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('/dev/sda\n/dev/sdb') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 036') // sda temp
        .mockResolvedValueOnce('194 Temperature_Celsius 038') // sdb temp
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours\ncontainer2,running,Up 1 hour') // containers
        .mockResolvedValueOnce('Cpu(s):  25.0 us\nMem :  16000 total,  8000 free'); // top

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Overall Status: OK');
      expect(result.content[0].text).toContain('[OK] Array Status');
      expect(result.content[0].text).toContain('[OK] Drive Temperatures');
      expect(result.content[0].text).toContain('[OK] Disk Space');
      expect(result.content[0].text).toContain('[OK] Container Health');
      expect(result.content[0].text).toContain('[OK] CPU & Memory');
    });

    it('should detect WARNING status for high temperatures', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('/dev/sda') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 055 Celsius') // high temp
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('Cpu(s):  25.0 us\nMem :  16000 total,  8000 free'); // top

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Overall Status: WARNING');
      expect(result.content[0].text).toContain('[WARNING] Drive Temperatures');
      expect(result.content[0].text).toContain('High temperatures detected');
    });

    it('should detect CRITICAL status for stopped array', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STOPPED') // array stopped
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('Cpu(s):  25.0 us\nMem :  16000 total,  8000 free'); // top

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Overall Status: CRITICAL');
      expect(result.content[0].text).toContain('[CRITICAL] Array Status');
      expect(result.content[0].text).toContain('Array is not started');
    });

    it('should detect critical disk space', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   96G    4G  96%') // df critical
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('Cpu(s):  25.0 us\nMem :  16000 total,  8000 free'); // top

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Overall Status: CRITICAL');
      expect(result.content[0].text).toContain('[CRITICAL] Disk Space');
      expect(result.content[0].text).toContain('96%');
    });

    it('should detect restarting containers', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,restarting,Restarting (1) 5 seconds ago') // restarting container
        .mockResolvedValueOnce('Cpu(s):  25.0 us\nMem :  16000 total,  8000 free'); // top

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Overall Status: CRITICAL');
      expect(result.content[0].text).toContain('[CRITICAL] Container Health');
      expect(result.content[0].text).toContain('Containers restarting');
    });

    it('should detect high CPU and memory usage', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('Cpu(s):  95.0 us\nMem :  16000 total,  800 free'); // high usage

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Overall Status: CRITICAL');
      expect(result.content[0].text).toContain('[CRITICAL] CPU & Memory');
      expect(result.content[0].text).toContain('Critical resource usage');
    });

    it('should handle partial failures gracefully', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('Array check failed')) // array status fails
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('Cpu(s):  25.0 us\nMem :  16000 total,  8000 free'); // top

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[WARNING] Array Status');
      expect(result.content[0].text).toContain('Unable to check array status');
    });
  });

  describe('health detect common issues', () => {
    it('should return no issues when system is healthy', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No issues detected');
    });

    it('should detect high temperature issues', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('/dev/sda') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 065 Celsius') // high temp
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[CRITICAL]');
      expect(result.content[0].text).toContain('temperature critical');
      expect(result.content[0].text).toContain('65°C');
    });

    it('should detect disk space issues', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   96G    4G  96%') // df critical
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[CRITICAL]');
      expect(result.content[0].text).toContain('critically full');
      expect(result.content[0].text).toContain('96%');
    });

    it('should detect container restart issues', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,restarting,Restarting (1) 5 seconds ago') // restarting
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[CRITICAL]');
      expect(result.content[0].text).toContain('stuck restarting');
    });

    it('should detect parity errors', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=5') // parity errors
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[HIGH]');
      expect(result.content[0].text).toContain('Parity errors detected: 5');
    });

    it('should detect parity sync in progress', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nmdResyncPos=50000\nmdResyncSize=100000\nsbSyncErrs=0') // sync in progress
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[LOW]');
      expect(result.content[0].text).toContain('Parity sync in progress');
      expect(result.content[0].text).toContain('50.0%');
    });

    it('should detect filesystem errors in logs', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('Jan 1 12:00:00 tower kernel: EXT4-fs error: filesystem was not cleanly unmounted'); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('[HIGH]');
      expect(result.content[0].text).toContain('not cleanly unmounted');
    });

    it('should sort issues by severity', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('/dev/sda') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 052 Celsius') // warning temp
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   96G    4G  96%') // critical disk
        .mockResolvedValueOnce('container1,running,Up 2 hours') // containers
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=2') // high - parity errors
        .mockResolvedValueOnce(''); // logs

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      const text = result.content[0].text;
      const criticalIndex = text.indexOf('[CRITICAL]');
      const highIndex = text.indexOf('[HIGH]');

      expect(criticalIndex).toBeLessThan(highIndex);
    });
  });

  describe('health threshold alerts', () => {
    it('should return no alerts when within thresholds', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  25.0 us') // CPU
        .mockResolvedValueOnce('Mem:  16000  6000') // Memory
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce(''); // no devices

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No thresholds exceeded');
      expect(result.content[0].text).toContain('CPU: 80%');
      expect(result.content[0].text).toContain('Memory: 90%');
    });

    it('should detect CPU threshold exceeded', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  85.0 us') // CPU high
        .mockResolvedValueOnce('Mem:  16000  6000') // Memory
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce(''); // no devices

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('1 Alert(s)');
      expect(result.content[0].text).toContain('CPU usage 85.0% exceeds threshold 80%');
    });

    it('should detect memory threshold exceeded', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  25.0 us') // CPU
        .mockResolvedValueOnce('Mem:  16000  15000') // Memory high
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce(''); // no devices

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('1 Alert(s)');
      expect(result.content[0].text).toContain('Memory usage 93.8% exceeds threshold 90%');
    });

    it('should detect disk threshold exceeded', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  25.0 us') // CPU
        .mockResolvedValueOnce('Mem:  16000  6000') // Memory
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   92G    8G  92%') // df high
        .mockResolvedValueOnce(''); // no devices

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('1 Alert(s)');
      expect(result.content[0].text).toContain('Disk /dev/md1 usage 92% exceeds threshold 90%');
    });

    it('should detect temperature threshold exceeded', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  25.0 us') // CPU
        .mockResolvedValueOnce('Mem:  16000  6000') // Memory
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('/dev/sda') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 055 Celsius'); // high temp

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('1 Alert(s)');
      expect(result.content[0].text).toContain('Drive sda temperature 55°C exceeds threshold 50°C');
    });

    it('should use custom thresholds', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  85.0 us') // CPU
        .mockResolvedValueOnce('Mem:  16000  6000') // Memory
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce(''); // no devices

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({
        cpuThreshold: 90,
        memThreshold: 95,
        diskThreshold: 95,
        tempThreshold: 60,
      });

      expect(result.content[0].text).toContain('No thresholds exceeded');
      expect(result.content[0].text).toContain('CPU: 90%');
    });

    it('should handle multiple alerts', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cpu(s):  85.0 us') // CPU high
        .mockResolvedValueOnce('Mem:  16000  15000') // Memory high
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   92G    8G  92%') // df high
        .mockResolvedValueOnce('/dev/sda') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 055 Celsius'); // temp high

      const tool = registeredTools.get('health threshold alerts');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('4 Alert(s)');
      expect(result.content[0].text).toContain('CPU usage 85.0%');
      expect(result.content[0].text).toContain('Memory usage 93.8%');
      expect(result.content[0].text).toContain('Disk /dev/md1 usage 92%');
      expect(result.content[0].text).toContain('Drive sda temperature 55°C');
    });
  });

  describe('health compare baseline', () => {
    it('should create new baseline when none exists', async () => {
      // Mock the sequence of calls for collecting current state
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker ps -a')) return 'container1\ncontainer2';
        if (cmd.includes('docker ps') && !cmd.includes('-a')) return 'container1\ncontainer2';
        if (cmd.includes('df')) return '/dev/sda1       100G   50G   50G  50%';
        if (cmd.includes('ps aux | wc -l')) return '150';
        if (cmd.includes('free')) return 'Mem:  16000000  8000000';
        if (cmd.includes('uptime')) return ' 12:30:45 up 5 days, 3:20';
        if (cmd.includes('cat')) throw new Error('File not found');
        if (cmd.includes('echo')) return ''; // save succeeds
        return '';
      });

      const tool = registeredTools.get('health compare baseline');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No existing baseline found');
      expect(result.content[0].text).toContain('Current state saved as new baseline');
      expect(result.content[0].text).toContain('"containerCount": 2');
    });

    it('should detect no changes when state is same', async () => {
      const baselineState = {
        timestamp: '2024-01-01T12:00:00Z',
        containerCount: 2,
        runningContainers: 2,
        rootDiskPercent: 50,
        processCount: 150,
        memoryPercent: '50.0',
      };

      // Collect current state first, then return baseline
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker ps -a')) return 'container1\ncontainer2';
        if (cmd.includes('docker ps') && !cmd.includes('-a')) return 'container1\ncontainer2';
        if (cmd.includes('df')) return '/dev/sda1       100G   50G   50G  50%';
        if (cmd.includes('ps aux | wc -l')) return '150';
        if (cmd.includes('free')) return 'Mem:  16000000  8000000';
        if (cmd.includes('uptime')) return ' 12:30:45 up 5 days, 3:20';
        if (cmd.includes('cat')) return JSON.stringify(baselineState);
        return '';
      });

      const tool = registeredTools.get('health compare baseline');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No significant changes detected');
    });

    it('should detect container count changes', async () => {
      const baselineState = {
        timestamp: '2024-01-01T12:00:00Z',
        containerCount: 2,
        runningContainers: 2,
        rootDiskPercent: 50,
        processCount: 150,
        memoryPercent: '50.0',
      };

      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker ps -a')) return 'container1\ncontainer2\ncontainer3';
        if (cmd.includes('docker ps') && !cmd.includes('-a')) return 'container1\ncontainer2';
        if (cmd.includes('df')) return '/dev/sda1       100G   50G   50G  50%';
        if (cmd.includes('ps aux | wc -l')) return '150';
        if (cmd.includes('free')) return 'Mem:  16000000  8000000';
        if (cmd.includes('uptime')) return ' 12:30:45 up 5 days, 3:20';
        if (cmd.includes('cat')) return JSON.stringify(baselineState);
        return '';
      });

      const tool = registeredTools.get('health compare baseline');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Change(s) Detected');
      expect(result.content[0].text).toContain('Container count: 2 -> 3 (+1)');
    });

    it('should detect disk usage changes', async () => {
      const baselineState = {
        timestamp: '2024-01-01T12:00:00Z',
        containerCount: 2,
        runningContainers: 2,
        rootDiskPercent: 50,
        processCount: 150,
        memoryPercent: '50.0',
      };

      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker ps -a')) return 'container1\ncontainer2';
        if (cmd.includes('docker ps') && !cmd.includes('-a')) return 'container1\ncontainer2';
        if (cmd.includes('df')) return '/dev/sda1       100G   75G   25G  75%';
        if (cmd.includes('ps aux | wc -l')) return '150';
        if (cmd.includes('free')) return 'Mem:  16000000  8000000';
        if (cmd.includes('uptime')) return ' 12:30:45 up 5 days, 3:20';
        if (cmd.includes('cat')) return JSON.stringify(baselineState);
        return '';
      });

      const tool = registeredTools.get('health compare baseline');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Change(s) Detected');
      expect(result.content[0].text).toContain('Root disk usage: 50% -> 75% (+25%)');
    });

    it('should detect memory usage changes', async () => {
      const baselineState = {
        timestamp: '2024-01-01T12:00:00Z',
        containerCount: 2,
        runningContainers: 2,
        rootDiskPercent: 50,
        processCount: 150,
        memoryPercent: '50.0',
      };

      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker ps -a')) return 'container1\ncontainer2';
        if (cmd.includes('docker ps') && !cmd.includes('-a')) return 'container1\ncontainer2';
        if (cmd.includes('df')) return '/dev/sda1       100G   50G   50G  50%';
        if (cmd.includes('ps aux | wc -l')) return '150';
        if (cmd.includes('free')) return 'Mem:  16000000  14000000';
        if (cmd.includes('uptime')) return ' 12:30:45 up 5 days, 3:20';
        if (cmd.includes('cat')) return JSON.stringify(baselineState);
        return '';
      });

      const tool = registeredTools.get('health compare baseline');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Change(s) Detected');
      expect(result.content[0].text).toContain('Memory usage:');
      expect(result.content[0].text).toMatch(/\+3[0-9]\.\d%/); // Approximately +37.5%
    });

    it('should use custom baseline file path', async () => {
      let catCalled = false;
      mockSSHExecutor.mockImplementation(async (cmd: string) => {
        if (cmd.includes('docker ps -a')) return 'container1';
        if (cmd.includes('docker ps') && !cmd.includes('-a')) return 'container1';
        if (cmd.includes('df')) return '/dev/sda1       100G   50G   50G  50%';
        if (cmd.includes('ps aux | wc -l')) return '150';
        if (cmd.includes('free')) return 'Mem:  16000000  8000000';
        if (cmd.includes('uptime')) return ' 12:30:45 up 5 days, 3:20';
        if (cmd.includes('cat /tmp/custom-baseline.json')) {
          catCalled = true;
          throw new Error('File not found');
        }
        if (cmd.includes('echo')) return ''; // save succeeds
        return '';
      });

      const tool = registeredTools.get('health compare baseline');
      const result = await tool.handler({ baselineFile: '/tmp/custom-baseline.json' });

      expect(catCalled).toBe(true);
      expect(result.content[0].text).toContain('/tmp/custom-baseline.json');
    });
  });

  describe('health generate diagnostic report', () => {
    it('should generate text format report', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Linux tower 5.10.0-unraid #1 SMP x86_64') // uname
        .mockResolvedValueOnce(' 12:30:45 up 5 days, 3:20, 2 users') // uptime
        .mockResolvedValueOnce('mdState=STARTED\nsbSyncErrs=0') // array status
        .mockResolvedValueOnce('NAME    STATE   STATUS\napp1    running Up 2 hours') // containers
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('/dev/sda\n/dev/sdb') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 036 Celsius') // sda temp
        .mockResolvedValueOnce('194 Temperature_Celsius 038 Celsius') // sdb temp
        .mockResolvedValueOnce('total        used        free\nMem:  16G    8G     8G') // free
        .mockResolvedValueOnce('Jan 1 12:00:00 tower kernel: System started'); // logs

      const tool = registeredTools.get('health generate diagnostic report');
      const result = await tool.handler({ format: 'text' });

      expect(result.content[0].text).toContain('UNRAID SYSTEM DIAGNOSTIC REPORT');
      expect(result.content[0].text).toContain('SYSTEM INFORMATION');
      expect(result.content[0].text).toContain('ARRAY STATUS');
      expect(result.content[0].text).toContain('CONTAINER STATUS');
      expect(result.content[0].text).toContain('DISK USAGE');
      expect(result.content[0].text).toContain('DRIVE TEMPERATURES');
      expect(result.content[0].text).toContain('RESOURCE USAGE');
      expect(result.content[0].text).toContain('RECENT SYSTEM LOGS');
      expect(result.content[0].text).toContain('END OF REPORT');
    });

    it('should generate markdown format report', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Linux tower 5.10.0-unraid') // uname
        .mockResolvedValueOnce(' 12:30:45 up 5 days') // uptime
        .mockResolvedValueOnce('mdState=STARTED') // array status
        .mockResolvedValueOnce('NAME    STATE\napp1    running') // containers
        .mockResolvedValueOnce('Filesystem      Size\n/dev/md1        100G') // df
        .mockResolvedValueOnce('/dev/sda') // device list
        .mockResolvedValueOnce('194 Temperature_Celsius 036 Celsius') // temp
        .mockResolvedValueOnce('total        used\nMem:  16G    8G') // free
        .mockResolvedValueOnce('System started'); // logs

      const tool = registeredTools.get('health generate diagnostic report');
      const result = await tool.handler({ format: 'markdown' });

      expect(result.content[0].text).toContain('# Unraid System Diagnostic Report');
      expect(result.content[0].text).toContain('## System Information');
      expect(result.content[0].text).toContain('## Array Status');
      expect(result.content[0].text).toContain('## Container Status');
      expect(result.content[0].text).toContain('## Disk Usage');
      expect(result.content[0].text).toContain('## Drive Temperatures');
      expect(result.content[0].text).toContain('**Kernel:**');
      expect(result.content[0].text).toContain('```');
    });

    it('should handle missing data gracefully', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('uname failed')) // uname
        .mockResolvedValueOnce('mdState=STARTED') // array status
        .mockResolvedValueOnce('app1    running') // containers
        .mockResolvedValueOnce('/dev/md1        100G') // df
        .mockResolvedValueOnce('') // no devices
        .mockResolvedValueOnce('Mem:  16G') // free
        .mockResolvedValueOnce('System log'); // logs

      const tool = registeredTools.get('health generate diagnostic report');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Unable to retrieve system information');
    });
  });

  describe('health snapshot system state', () => {
    it('should capture complete system snapshot', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('container1,running\ncontainer2,exited') // docker ps -a
        .mockResolvedValueOnce('Filesystem      Size  Used Avail Use%\n/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('150') // ps count
        .mockResolvedValueOnce('5') // running processes
        .mockResolvedValueOnce('Mem:  16G    8G     8G') // free
        .mockResolvedValueOnce(' 12:30:45 up 5 days, 3:20'); // uptime

      const tool = registeredTools.get('health snapshot system state');
      const result = await tool.handler({});

      const snapshot = JSON.parse(result.content[0].text.split('\n\n')[1]);

      expect(snapshot.containers.total).toBe(2);
      expect(snapshot.containers.running).toBe(1);
      expect(snapshot.containers.stopped).toBe(1);
      expect(snapshot.containers.list).toContain('container1: running');
      expect(snapshot.containers.list).toContain('container2: exited');
      expect(snapshot.diskUsage[0].path).toBe('/dev/md1');
      expect(snapshot.diskUsage[0].usePercent).toBe('50');
      expect(snapshot.processes.total).toBe(150);
      expect(snapshot.memory.total).toBe('16G');
    });

    it('should save snapshot with custom name', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('container1,running') // docker ps -a
        .mockResolvedValueOnce('/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('150') // ps count
        .mockResolvedValueOnce('5') // running processes
        .mockResolvedValueOnce('Mem:  16G    8G     8G') // free
        .mockResolvedValueOnce(' 12:30:45 up 5 days') // uptime
        .mockResolvedValueOnce(''); // echo to save snapshot

      const tool = registeredTools.get('health snapshot system state');
      const result = await tool.handler({ name: 'pre-upgrade' });

      expect(result.content[0].text).toContain('Saved to:');
      expect(result.content[0].text).toMatch(/\/tmp\/snapshot-pre-upgrade-\d+\.json/);

      // Find the echo call
      const echoCalls = mockSSHExecutor.mock.calls.filter((call: any[]) =>
        typeof call[0] === 'string' && call[0].includes('echo') && call[0].includes('snapshot-pre-upgrade')
      );
      expect(echoCalls.length).toBeGreaterThan(0);
    });

    it('should handle docker unavailable', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('Docker not running')) // docker ps -a
        .mockResolvedValueOnce('/dev/md1        100G   50G   50G  50%') // df
        .mockResolvedValueOnce('150') // ps count
        .mockResolvedValueOnce('5') // running processes
        .mockResolvedValueOnce('Mem:  16G    8G     8G') // free
        .mockResolvedValueOnce(' 12:30:45 up 5 days'); // uptime

      const tool = registeredTools.get('health snapshot system state');
      const result = await tool.handler({});

      // The output starts with "=== System State Snapshot ===" and then JSON
      const text = result.content[0].text;
      const jsonStart = text.indexOf('{');
      const snapshotJson = text.substring(jsonStart);
      const snapshot = JSON.parse(snapshotJson);

      expect(snapshot.containers.total).toBe(0);
      expect(snapshot.containers.running).toBe(0);
    });
  });

  describe('Integration Tests', () => {
    it('should handle concurrent tool calls', async () => {
      mockSSHExecutor
        .mockResolvedValue('mdState=STARTED\nsbSyncErrs=0') // For health check
        .mockResolvedValue('') // For detect issues
        .mockResolvedValue('Cpu(s):  25.0 us'); // For threshold alerts

      const healthTool = registeredTools.get('health check comprehensive');
      const issuesTool = registeredTools.get('health detect common issues');
      const alertsTool = registeredTools.get('health threshold alerts');

      const [healthResult, issuesResult, alertsResult] = await Promise.all([
        healthTool.handler({}),
        issuesTool.handler({}),
        alertsTool.handler({}),
      ]);

      expect(healthResult.content[0].text).toContain('Health Check');
      expect(issuesResult.content[0].text).toContain('Common Issues Detection');
      expect(alertsResult.content[0].text).toContain('Threshold Alerts');
    });
  });

  describe('Error Handling', () => {
    it('should handle SSH executor failures gracefully in health check', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH connection lost'));

      const tool = registeredTools.get('health check comprehensive');
      const result = await tool.handler({});

      // The tool catches errors gracefully and returns partial results with WARNING status
      // Check that it handles the error without crashing
      expect(result.content[0].text).toContain('Comprehensive Health Check');
      expect(result.content[0].text).toContain('Unable to check');
    });

    it('should handle non-Error objects in catch blocks for detect_common_issues', async () => {
      mockSSHExecutor.mockRejectedValue('String error message');

      const tool = registeredTools.get('health detect common issues');
      const result = await tool.handler({});

      // detect_common_issues gracefully handles errors and still returns results
      expect(result.content[0].text).toContain('Common Issues Detection');
    });
  });
});
