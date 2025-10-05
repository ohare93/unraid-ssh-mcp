import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerUnraidTools } from '../unraid-tools.js';

describe('Unraid Tools', () => {
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
    registerUnraidTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 5 Unraid tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(5);
      expect(registeredTools.has('unraid array status')).toBe(true);
      expect(registeredTools.has('unraid drive smart status')).toBe(true);
      expect(registeredTools.has('unraid check temperatures')).toBe(true);
      expect(registeredTools.has('unraid shares list')).toBe(true);
      expect(registeredTools.has('unraid share usage')).toBe(true);
    });
  });

  describe('unraid array status', () => {
    it('should get array status from /proc/mdcmd', async () => {
      const mockStatus = `mdState=STARTED
mdResync=0
mdResyncPos=0
mdResyncSize=0
sbName=Tower
sbVersion=6.12.6`;

      mockSSHExecutor.mockResolvedValue(mockStatus);

      const tool = registeredTools.get('unraid array status');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('cat /proc/mdcmd');
      expect(result.content[0].text).toContain('Unraid Array Status');
      expect(result.content[0].text).toContain('mdState=STARTED');
    });

    it('should fallback to mdcmd status if /proc/mdcmd fails', async () => {
      const mockStatus = 'Array State: Started\nParity: Valid';

      // First call fails, second succeeds
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('Cannot read /proc/mdcmd'))
        .mockResolvedValueOnce(mockStatus);

      const tool = registeredTools.get('unraid array status');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('cat /proc/mdcmd');
      expect(mockSSHExecutor).toHaveBeenCalledWith('mdcmd status');
      expect(result.content[0].text).toContain('Unraid Array Status');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Command failed'));

      const tool = registeredTools.get('unraid array status');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting array status');
    });
  });

  describe('unraid drive smart status', () => {
    it('should get SMART status for SATA drive', async () => {
      const mockSmart = `=== START OF INFORMATION SECTION ===
Device Model:     WDC WD80EFZX-68UW8N0
Serial Number:    XXXXXXXX
Firmware Version: 83.00A83
User Capacity:    8,001,563,222,016 bytes [8.00 TB]
SMART overall-health self-assessment test result: PASSED
Temperature_Celsius     36 Celsius`;

      mockSSHExecutor.mockResolvedValue(mockSmart);

      const tool = registeredTools.get('unraid drive smart status');
      const result = await tool.handler({ device: 'sda' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('smartctl -a -d ata /dev/sda || smartctl -a /dev/sda');
      expect(result.content[0].text).toContain('SMART Status - sda');
      expect(result.content[0].text).toContain('WDC WD80EFZX');
    });

    it('should get SMART status for NVMe drive', async () => {
      const mockSmart = `=== START OF INFORMATION SECTION ===
Model Number:     Samsung SSD 970 EVO Plus 1TB
Serial Number:    XXXXXXXX
Firmware Version: 2B2QEXM7
SMART overall-health self-assessment test result: PASSED
Temperature:      45 Celsius`;

      mockSSHExecutor.mockResolvedValue(mockSmart);

      const tool = registeredTools.get('unraid drive smart status');
      const result = await tool.handler({ device: 'nvme0n1' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('smartctl -a -d nvme /dev/nvme0n1');
      expect(result.content[0].text).toContain('SMART Status - nvme0n1');
      expect(result.content[0].text).toContain('Samsung SSD 970 EVO Plus');
    });

    it('should handle SMART errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Device not found'));

      const tool = registeredTools.get('unraid drive smart status');
      const result = await tool.handler({ device: 'sda' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting SMART status');
    });
  });

  describe('unraid check temperatures', () => {
    it('should get system and drive temperatures', async () => {
      const sensorsOutput = `coretemp-isa-0000
Adapter: ISA adapter
Core 0:        +45.0°C  (high = +80.0°C, crit = +100.0°C)
Core 1:        +47.0°C  (high = +80.0°C, crit = +100.0°C)`;

      const devicesList = '/dev/sda\n/dev/sdb\n/dev/nvme0n1';
      const sdaTempOutput = '194 Temperature_Celsius     0x0022   036   059   000    Old_age   Always       -       36';
      const sdbTempOutput = '194 Temperature_Celsius     0x0022   038   061   000    Old_age   Always       -       38';
      const nvmeTempOutput = 'Temperature:                        42 Celsius';

      mockSSHExecutor
        .mockResolvedValueOnce(sensorsOutput) // sensors
        .mockResolvedValueOnce(devicesList) // ls devices
        .mockResolvedValueOnce(sdaTempOutput) // sda temp
        .mockResolvedValueOnce(sdbTempOutput) // sdb temp
        .mockResolvedValueOnce(nvmeTempOutput); // nvme temp

      const tool = registeredTools.get('unraid check temperatures');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('System Temperatures');
      expect(result.content[0].text).toContain('Drive Temperatures');
      expect(result.content[0].text).toContain('Core 0');
      expect(result.content[0].text).toContain('sda');
      expect(result.content[0].text).toContain('nvme0n1');
    });

    it('should handle sensors not available', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('sensors command not available')
        .mockResolvedValueOnce(''); // no devices

      const tool = registeredTools.get('unraid check temperatures');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('System Temperatures');
      expect(result.content[0].text).toContain('sensors command not available');
    });

    it('should handle individual drive temperature failures', async () => {
      const devicesList = '/dev/sda\n/dev/sdb';

      mockSSHExecutor
        .mockResolvedValueOnce('CPU: 45°C') // sensors
        .mockResolvedValueOnce(devicesList) // ls devices
        .mockResolvedValueOnce('Temperature: 36°C') // sda success
        .mockRejectedValueOnce(new Error('SMART not supported')); // sdb fails

      const tool = registeredTools.get('unraid check temperatures');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('sda');
      expect(result.content[0].text).toContain('36°C');
      expect(result.content[0].text).toContain('sdb: Unable to read temperature');
    });

    it('should handle complete temperature check failure', async () => {
      // Mock the initial sensors call to fail completely
      mockSSHExecutor.mockRejectedValue(new Error('SSH connection lost'));

      const tool = registeredTools.get('unraid check temperatures');
      const result = await tool.handler({});

      // The function handles errors gracefully and returns partial results
      // Even if sensors fails, it still tries to get drive temps
      expect(result.content[0].text).toContain('System Temperatures');
      expect(result.content[0].text).toContain('Could not retrieve');
    });
  });

  describe('unraid shares list', () => {
    it('should list all user shares', async () => {
      const mockShares = `total 24
drwxrwxrwx 6 root root  6 Dec  1 10:00 .
drwxr-xr-x 8 root root  8 Nov 15 08:30 ..
drwxrwxrwx 5 nobody users 5 Dec  1 09:45 appdata
drwxrwxrwx 3 nobody users 3 Nov 20 14:20 backups
drwxrwxrwx 8 nobody users 8 Dec  1 11:30 media
drwxrwxrwx 4 nobody users 4 Nov 28 16:15 documents`;

      mockSSHExecutor.mockResolvedValue(mockShares);

      const tool = registeredTools.get('unraid shares list');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('ls -la /mnt/user/');
      expect(result.content[0].text).toContain('Unraid User Shares');
      expect(result.content[0].text).toContain('appdata');
      expect(result.content[0].text).toContain('media');
    });

    it('should handle errors listing shares', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Permission denied'));

      const tool = registeredTools.get('unraid shares list');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error listing shares');
    });
  });

  describe('unraid share usage', () => {
    it('should get usage for all shares', async () => {
      const mockUsage = `2.5T\t/mnt/user/appdata
500G\t/mnt/user/backups
8.2T\t/mnt/user/media
150G\t/mnt/user/documents`;

      mockSSHExecutor.mockResolvedValue(mockUsage);

      const tool = registeredTools.get('unraid share usage');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('du -sh /mnt/user/*');
      expect(result.content[0].text).toContain('All Shares Usage');
      expect(result.content[0].text).toContain('2.5T');
      expect(result.content[0].text).toContain('appdata');
      expect(result.content[0].text).toContain('media');
    });

    it('should get usage for specific share', async () => {
      const mockUsage = '2.5T\t/mnt/user/appdata';

      mockSSHExecutor
        .mockResolvedValueOnce('') // test -d check passes
        .mockResolvedValueOnce(mockUsage); // du -sh result

      const tool = registeredTools.get('unraid share usage');
      const result = await tool.handler({ share: 'appdata' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('test -d /mnt/user/appdata');
      expect(mockSSHExecutor).toHaveBeenCalledWith('du -sh /mnt/user/appdata');
      expect(result.content[0].text).toContain('Share Usage - appdata');
      expect(result.content[0].text).toContain('2.5T');
    });

    it('should handle non-existent share', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('test: No such file or directory'));

      const tool = registeredTools.get('unraid share usage');
      const result = await tool.handler({ share: 'nonexistent' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting share usage');
    });

    it('should handle du command errors', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('') // test -d passes
        .mockRejectedValueOnce(new Error('du: cannot access')); // du fails

      const tool = registeredTools.get('unraid share usage');
      const result = await tool.handler({ share: 'appdata' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting share usage');
    });
  });

  describe('Integration - Multiple Tool Usage', () => {
    it('should handle concurrent tool calls', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED') // array status
        .mockResolvedValueOnce('appdata\nmedia\nbackups'); // shares list

      const arrayTool = registeredTools.get('unraid array status');
      const sharesTool = registeredTools.get('unraid shares list');

      const [arrayResult, sharesResult] = await Promise.all([
        arrayTool.handler({}),
        sharesTool.handler({}),
      ]);

      expect(arrayResult.content[0].text).toContain('Array Status');
      expect(sharesResult.content[0].text).toContain('User Shares');
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle non-Error objects in catch blocks', async () => {
      mockSSHExecutor.mockRejectedValue('String error message');

      const tool = registeredTools.get('unraid array status');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting array status');
    });

    it('should handle empty responses gracefully', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('unraid shares list');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Unraid User Shares');
    });
  });
});
