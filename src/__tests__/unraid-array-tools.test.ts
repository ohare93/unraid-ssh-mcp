import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerUnraidArrayTools } from '../unraid-array-tools.js';

describe('Unraid Array Tools', () => {
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
    registerUnraidArrayTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register all 9 Unraid array tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(9);
      expect(registeredTools.has('unraid parity check status')).toBe(true);
      expect(registeredTools.has('unraid parity check history')).toBe(true);
      expect(registeredTools.has('unraid array sync status')).toBe(true);
      expect(registeredTools.has('unraid disk spin status')).toBe(true);
      expect(registeredTools.has('unraid unclean shutdown check')).toBe(true);
      expect(registeredTools.has('unraid mover status')).toBe(true);
      expect(registeredTools.has('unraid mover log')).toBe(true);
      expect(registeredTools.has('unraid cache usage')).toBe(true);
      expect(registeredTools.has('unraid check split level')).toBe(true);
    });
  });

  describe('unraid parity check status', () => {
    it('should get parity check status when check is in progress', async () => {
      const mockMdcmd = `mdState=STARTED
mdResync=1
mdResyncPos=12345678
mdResyncSize=23456789
mdResyncAction=check`;

      const mockSyslog = 'Dec 15 10:30:00 Tower kernel: md: parity check started';
      const mockMdstat = 'Personalities : [raid6] [raid5] [raid4]\nmd1 : active';

      mockSSHExecutor
        .mockResolvedValueOnce(mockMdcmd)
        .mockResolvedValueOnce(mockSyslog)
        .mockResolvedValueOnce(mockMdstat);

      const tool = registeredTools.get('unraid parity check status');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith('cat /proc/mdcmd');
      expect(result.content[0].text).toContain('Parity Check Status');
      expect(result.content[0].text).toContain('In progress');
      expect(result.content[0].text).toMatch(/52\.6[0-9]%/);
    });

    it('should show status when no parity check is running', async () => {
      const mockMdcmd = `mdState=STARTED
mdResync=0
mdResyncPos=0
mdResyncSize=0`;

      const mockSyslog = 'No recent parity check entries found';

      mockSSHExecutor
        .mockResolvedValueOnce(mockMdcmd)
        .mockResolvedValueOnce(mockSyslog)
        .mockResolvedValueOnce('md1: active');

      const tool = registeredTools.get('unraid parity check status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Not running');
    });

    it('should handle errors gracefully with partial data', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Cannot read /proc/mdcmd'));

      const tool = registeredTools.get('unraid parity check status');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Could not read /proc/mdcmd');
      expect(result.content[0].text).toContain('Parity Check Status');
    });

    it('should handle partial data when mdcmd read fails but syslog works', async () => {
      mockSSHExecutor
        .mockRejectedValueOnce(new Error('Cannot read /proc/mdcmd'))
        .mockResolvedValueOnce('Dec 15 10:30:00 Tower kernel: parity check completed')
        .mockResolvedValueOnce('md1: active');

      const tool = registeredTools.get('unraid parity check status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Could not read /proc/mdcmd');
      expect(result.content[0].text).toContain('Recent Parity Check Log Entries');
    });
  });

  describe('unraid parity check history', () => {
    it('should retrieve historical parity check results', async () => {
      const mockLogs = `Dec 1 02:00:00 Tower kernel: parity check finished
Dec 8 02:00:00 Tower kernel: parity check finished
Dec 15 02:00:00 Tower kernel: parity check finished`;

      const mockHistoryFile = `2023-12-01 02:35:22|0 errors|Duration: 6h 35m
2023-12-08 02:33:15|0 errors|Duration: 6h 33m
2023-12-15 02:38:40|0 errors|Duration: 6h 38m`;

      mockSSHExecutor
        .mockResolvedValueOnce(mockLogs)
        .mockResolvedValueOnce(mockHistoryFile);

      const tool = registeredTools.get('unraid parity check history');
      const result = await tool.handler({ limit: 3 });

      expect(result.content[0].text).toContain('Parity Check History');
      expect(result.content[0].text).toContain('finished');
      expect(result.content[0].text).toContain('Duration');
    });

    it('should respect custom limit parameter', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('parity check log entries')
        .mockResolvedValueOnce('');

      const tool = registeredTools.get('unraid parity check history');
      const result = await tool.handler({ limit: 10 });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining('tail -n 30')
      );
      expect(result.content[0].text).toContain('Last 10');
    });

    it('should handle no history found', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      const tool = registeredTools.get('unraid parity check history');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No parity check history found');
    });

    it('should handle errors gracefully with partial data', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Command failed'));

      const tool = registeredTools.get('unraid parity check history');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Parity Check History');
      expect(result.content[0].text).toContain('Could not retrieve');
    });
  });

  describe('unraid array sync status', () => {
    it('should show array sync in progress', async () => {
      const mockMdcmd = `mdState=STARTED
mdResync=1
mdResyncPos=5000000
mdResyncSize=10000000
mdResyncAction=recon`;

      const mockMdstat = 'md1 : active raid6 [==>..................]  recovery = 50.0%';

      mockSSHExecutor
        .mockResolvedValueOnce(mockMdcmd)
        .mockResolvedValueOnce(mockMdstat);

      const tool = registeredTools.get('unraid array sync status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Array Sync/Rebuild Status');
      expect(result.content[0].text).toContain('in progress');
    });

    it('should show no sync in progress', async () => {
      const mockMdcmd = `mdState=STARTED
mdResync=0`;

      const mockMdstat = 'md1 : active raid6';

      mockSSHExecutor
        .mockResolvedValueOnce(mockMdcmd)
        .mockResolvedValueOnce(mockMdstat);

      const tool = registeredTools.get('unraid array sync status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No sync or rebuild in progress');
    });

    it('should handle errors', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Cannot read mdcmd'));

      const tool = registeredTools.get('unraid array sync status');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error getting array sync status');
    });
  });

  describe('unraid disk spin status', () => {
    it('should check spin status of all SATA drives', async () => {
      const mockDevices = '/dev/sda\n/dev/sdb\n/dev/sdc';
      const mockSdaStatus = 'drive state is:  active/idle';
      const mockSdbStatus = 'drive state is:  standby';
      const mockSdcStatus = 'drive state is:  active/idle';

      mockSSHExecutor
        .mockResolvedValueOnce(mockDevices)
        .mockResolvedValueOnce(mockSdaStatus)
        .mockResolvedValueOnce(mockSdbStatus)
        .mockResolvedValueOnce(mockSdcStatus)
        .mockResolvedValueOnce(''); // no nvme

      const tool = registeredTools.get('unraid disk spin status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Disk Spin Status');
      expect(result.content[0].text).toContain('sda');
      expect(result.content[0].text).toContain('active/idle');
      expect(result.content[0].text).toContain('standby');
    });

    it('should handle drives that fail status check', async () => {
      const mockDevices = '/dev/sda\n/dev/sdb';

      mockSSHExecutor
        .mockResolvedValueOnce(mockDevices)
        .mockResolvedValueOnce('drive state is: active/idle')
        .mockRejectedValueOnce(new Error('hdparm: HDIO_DRIVE_CMD failed'))
        .mockResolvedValueOnce('');

      const tool = registeredTools.get('unraid disk spin status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('sda');
      expect(result.content[0].text).toContain('sdb: Unable to check status');
    });

    it('should check NVMe drives power states', async () => {
      const mockSataDevices = '/dev/sda';
      const mockNvmeDevices = '/dev/nvme0n1';

      mockSSHExecutor
        .mockResolvedValueOnce(mockSataDevices)
        .mockResolvedValueOnce('drive state is: active/idle')
        .mockResolvedValueOnce(mockNvmeDevices)
        .mockResolvedValueOnce('power_state : 0 (Active)');

      const tool = registeredTools.get('unraid disk spin status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('NVMe Power States');
      expect(result.content[0].text).toContain('nvme0n1');
    });

    it('should handle no drives found', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('');

      const tool = registeredTools.get('unraid disk spin status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No SATA drives found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('ls failed'));

      const tool = registeredTools.get('unraid disk spin status');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error checking disk spin status');
    });
  });

  describe('unraid unclean shutdown check', () => {
    it('should detect unclean shutdown marker', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('UNCLEAN SHUTDOWN MARKER FOUND')
        .mockResolvedValueOnce('-rw-r--r-- 1 root root 0 Dec 15 10:00 unclean.log')
        .mockResolvedValueOnce('Dec 15 10:05:00 Tower kernel: System shutdown')
        .mockResolvedValueOnce('No filesystem errors in dmesg');

      const tool = registeredTools.get('unraid unclean shutdown check');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('UNCLEAN SHUTDOWN MARKER FOUND');
      expect(result.content[0].text).toContain('Boot Logs Directory');
    });

    it('should show clean shutdown', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('No unclean shutdown marker')
        .mockResolvedValueOnce('-rw-r--r-- 1 root root 1024 Dec 15 10:00 syslog')
        .mockResolvedValueOnce('Dec 15 10:00:00 Tower shutdown: clean')
        .mockResolvedValueOnce('No filesystem errors in dmesg');

      const tool = registeredTools.get('unraid unclean shutdown check');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No unclean shutdown marker');
      expect(result.content[0].text).toContain('Recent Shutdown/Reboot Events');
    });

    it('should detect filesystem errors', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('No unclean shutdown marker')
        .mockResolvedValueOnce('Boot logs accessible')
        .mockResolvedValueOnce('Shutdown events')
        .mockResolvedValueOnce('ext4-fs error: journal commit failed');

      const tool = registeredTools.get('unraid unclean shutdown check');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('journal commit failed');
    });

    it('should handle errors gracefully with partial data', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Access denied'));

      const tool = registeredTools.get('unraid unclean shutdown check');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Unclean Shutdown Check');
      expect(result.content[0].text).toContain('Could not check');
    });
  });

  describe('unraid mover status', () => {
    it('should detect mover running', async () => {
      const mockProcess = 'root     12345  0.1  0.2  12345  6789 ?        S    10:00   0:01 /usr/local/sbin/mover';
      const mockLogs = 'Dec 15 10:00:00 Tower mover: started';
      const mockCron = '0 3 * * * /usr/local/sbin/mover';

      mockSSHExecutor
        .mockResolvedValueOnce(mockProcess)
        .mockResolvedValueOnce(mockLogs)
        .mockResolvedValueOnce(mockCron);

      const tool = registeredTools.get('unraid mover status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Status: RUNNING');
      expect(result.content[0].text).toContain('mover');
      expect(result.content[0].text).toContain('Mover Schedule');
    });

    it('should show mover not running', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('Dec 15 03:00:00 Tower mover: finished')
        .mockResolvedValueOnce('0 3 * * * /usr/local/sbin/mover');

      const tool = registeredTools.get('unraid mover status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Status: Not running');
      expect(result.content[0].text).toContain('finished');
    });

    it('should handle no mover logs found', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('No recent mover activity found')
        .mockResolvedValueOnce('No mover cron jobs found');

      const tool = registeredTools.get('unraid mover status');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No recent mover activity found');
    });

    it('should handle errors gracefully with partial data', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Command failed'));

      const tool = registeredTools.get('unraid mover status');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Mover Status');
      expect(result.content[0].text).toContain('Could not');
    });
  });

  describe('unraid mover log', () => {
    it('should retrieve mover logs with default lines', async () => {
      const mockLogs = `Dec 15 03:00:00 Tower mover: started
Dec 15 03:01:00 Tower mover: move /mnt/cache/appdata/file1.txt
Dec 15 03:05:00 Tower mover: finished`;

      mockSSHExecutor.mockResolvedValue(mockLogs);

      const tool = registeredTools.get('unraid mover log');
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining('tail -n 100')
      );
      expect(result.content[0].text).toContain('Mover Log (Last 100 lines)');
      expect(result.content[0].text).toContain('started');
      expect(result.content[0].text).toContain('finished');
    });

    it('should respect custom lines parameter', async () => {
      mockSSHExecutor.mockResolvedValue('mover log entries');

      const tool = registeredTools.get('unraid mover log');
      const result = await tool.handler({ lines: 50 });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining('tail -n 50')
      );
      expect(result.content[0].text).toContain('Last 50 lines');
    });

    it('should handle no mover logs found', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('unraid mover log');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No mover log entries found');
    });

    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Cannot read syslog'));

      const tool = registeredTools.get('unraid mover log');
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error reading mover log');
    });
  });

  describe('unraid cache usage', () => {
    it('should get cache usage and breakdown', async () => {
      const mockDF = `Filesystem      Size  Used Avail Use% Mounted on
/dev/sdc1       932G  456G  476G  49% /mnt/cache`;

      const mockBreakdown = `45G\t/mnt/cache/appdata
123G\t/mnt/cache/domains
288G\t/mnt/cache/downloads`;

      mockSSHExecutor
        .mockResolvedValueOnce(mockDF)
        .mockResolvedValueOnce(mockBreakdown)
        .mockResolvedValueOnce('Not a btrfs cache');

      const tool = registeredTools.get('unraid cache usage');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Cache Disk Usage');
      expect(result.content[0].text).toContain('456G');
      expect(result.content[0].text).toContain('appdata');
      expect(result.content[0].text).toContain('downloads');
    });

    it('should show btrfs pool information', async () => {
      const mockDF = 'Filesystem 1G-blocks';
      const mockBreakdown = '100G\t/mnt/cache/appdata';
      const mockBtrfs = 'Label: cache  uuid: abc123\n\tTotal devices 2 FS bytes used 456.00GiB';

      mockSSHExecutor
        .mockResolvedValueOnce(mockDF)
        .mockResolvedValueOnce(mockBreakdown)
        .mockResolvedValueOnce(mockBtrfs);

      const tool = registeredTools.get('unraid cache usage');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Cache Pool Info (btrfs)');
      expect(result.content[0].text).toContain('Total devices 2');
    });

    it('should handle cache not mounted', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('Cache not mounted')
        .mockResolvedValueOnce('No cache contents found')
        .mockResolvedValueOnce('Not a btrfs cache');

      const tool = registeredTools.get('unraid cache usage');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Cache not mounted');
    });

    it('should handle errors gracefully with partial data', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('df failed'));

      const tool = registeredTools.get('unraid cache usage');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Cache Disk Usage');
      expect(result.content[0].text).toContain('Could not get');
    });
  });

  describe('unraid check split level', () => {
    it('should check specific share configuration', async () => {
      const mockConfig = `shareComment="Application Data"
shareUseCache="prefer"
splitLevel="1"
shareInclude="cache,disk1,disk2"`;

      mockSSHExecutor.mockResolvedValue(mockConfig);

      const tool = registeredTools.get('unraid check split level');
      const result = await tool.handler({ share: 'appdata' });

      expect(mockSSHExecutor).toHaveBeenCalledWith('cat /boot/config/shares/appdata.cfg 2>/dev/null || echo \'Share config not found\'');
      expect(result.content[0].text).toContain('Split Level Config - appdata');
      expect(result.content[0].text).toContain('splitLevel="1"');
    });

    it('should check all shares when no share specified', async () => {
      const mockList = '/boot/config/shares/appdata.cfg\n/boot/config/shares/media.cfg';
      const mockAppdataConfig = 'splitLevel="1"';
      const mockMediaConfig = 'splitLevel="2"\nshareUseCache="yes"';

      mockSSHExecutor
        .mockResolvedValueOnce(mockList)
        .mockResolvedValueOnce(mockAppdataConfig)
        .mockResolvedValueOnce(mockMediaConfig);

      const tool = registeredTools.get('unraid check split level');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('All Shares');
      expect(result.content[0].text).toContain('appdata');
      expect(result.content[0].text).toContain('media');
      expect(result.content[0].text).toContain('splitLevel="1"');
      expect(result.content[0].text).toContain('splitLevel="2"');
    });

    it('should handle share config not found', async () => {
      mockSSHExecutor.mockResolvedValue('Share config not found');

      const tool = registeredTools.get('unraid check split level');
      const result = await tool.handler({ share: 'nonexistent' });

      expect(result.content[0].text).toContain('Configuration file not found');
    });

    it('should handle no share configs found', async () => {
      mockSSHExecutor.mockResolvedValue('No share configs found');

      const tool = registeredTools.get('unraid check split level');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No share configuration files found');
    });

    it('should handle shares without split level set', async () => {
      const mockConfig = 'shareComment="Test Share"\nshareUseCache="no"';

      mockSSHExecutor
        .mockResolvedValueOnce('/boot/config/shares/test.cfg')
        .mockResolvedValueOnce(mockConfig);

      const tool = registeredTools.get('unraid check split level');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('not set (using default)');
    });

    it('should handle errors gracefully with partial data', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('Cannot access config files'));

      const tool = registeredTools.get('unraid check split level');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Split Level Config');
      expect(result.content[0].text).toContain('Could not');
    });
  });

  describe('Integration - Multiple Tool Usage', () => {
    it('should handle concurrent tool calls', async () => {
      mockSSHExecutor
        .mockResolvedValueOnce('mdState=STARTED\nmdResync=0')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('df output')
        .mockResolvedValueOnce('du output')
        .mockResolvedValueOnce('not btrfs');

      const syncTool = registeredTools.get('unraid array sync status');
      const cacheTool = registeredTools.get('unraid cache usage');

      const [syncResult, cacheResult] = await Promise.all([
        syncTool.handler({}),
        cacheTool.handler({}),
      ]);

      expect(syncResult.content[0].text).toContain('Array Sync');
      expect(cacheResult.content[0].text).toContain('Cache Disk Usage');
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle non-Error objects in catch blocks', async () => {
      mockSSHExecutor.mockRejectedValue('String error message');

      const tool = registeredTools.get('unraid mover status');
      const result = await tool.handler({});

      // Tool handles errors gracefully and returns partial data
      expect(result.content[0].text).toContain('Mover Status');
      expect(result.content[0].text).toContain('Could not');
    });

    it('should handle empty responses gracefully', async () => {
      mockSSHExecutor.mockResolvedValue('');

      const tool = registeredTools.get('unraid mover log');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('No mover log entries found');
    });

    it('should handle malformed data gracefully', async () => {
      mockSSHExecutor.mockResolvedValue('invalid\ndata\nformat');

      const tool = registeredTools.get('unraid parity check status');
      const result = await tool.handler({});

      // Should not throw, should still return some output
      expect(result.content[0].text).toContain('Parity Check Status');
    });
  });
});
