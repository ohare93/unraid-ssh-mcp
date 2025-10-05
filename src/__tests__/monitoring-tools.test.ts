import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMonitoringTools } from "../monitoring-tools.js";

describe("Monitoring Tools", () => {
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
    registerMonitoringTools(mockServer as any, mockSSHExecutor);
  });

  describe("Tool Registration", () => {
    it("should register all 5 monitoring tools", () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(5);
      expect(registeredTools.has("monitoring ps list")).toBe(true);
      expect(registeredTools.has("monitoring process tree")).toBe(true);
      expect(registeredTools.has("monitoring top snapshot")).toBe(true);
      expect(registeredTools.has("monitoring iostat snapshot")).toBe(true);
      expect(registeredTools.has("monitoring network connections")).toBe(true);
    });
  });

  describe("monitoring ps list", () => {
    it("should list all processes without sorting", async () => {
      const mockOutput = `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1 168916 13312 ?        Ss   Jan01   0:05 /sbin/init
root         2  0.0  0.0      0     0 ?        S    Jan01   0:00 [kthreadd]
www-data  1234  5.2  2.3 256789 45678 ?        S    10:30   1:23 /usr/bin/nginx`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring ps list");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith("ps aux");
      expect(result.content[0].text).toContain("Process List");
      expect(result.content[0].text).toContain("/sbin/init");
      expect(result.content[0].text).toContain("nginx");
      expect(result.isError).toBeUndefined();
    });

    it("should sort by CPU when requested", async () => {
      const mockOutput = `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
www-data  1234  5.2  2.3 256789 45678 ?        S    10:30   1:23 /usr/bin/nginx
root         1  0.0  0.1 168916 13312 ?        Ss   Jan01   0:05 /sbin/init`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring ps list");
      const result = await tool.handler({ sortBy: "cpu" });

      expect(mockSSHExecutor).toHaveBeenCalledWith("ps aux --sort=-%cpu");
      expect(result.content[0].text).toContain("sorted by cpu");
      expect(result.content[0].text).toContain("nginx");
    });

    it("should sort by memory when requested", async () => {
      const mockOutput = `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
mysql     5678  2.1  8.5 1024000 98765 ?        Sl   Jan01  12:34 /usr/sbin/mysqld
root         1  0.0  0.1 168916 13312 ?        Ss   Jan01   0:05 /sbin/init`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring ps list");
      const result = await tool.handler({ sortBy: "memory" });

      expect(mockSSHExecutor).toHaveBeenCalledWith("ps aux --sort=-%mem");
      expect(result.content[0].text).toContain("sorted by memory");
      expect(result.content[0].text).toContain("mysqld");
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("monitoring ps list");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error listing processes");
      expect(result.content[0].text).toContain("Permission denied");
    });
  });

  describe("monitoring process tree", () => {
    it("should show process tree with pstree", async () => {
      const mockOutput = `systemd(1)─┬─sshd(1234)───bash(5678)
           ├─docker(2345)─┬─nginx(3456)
           │              └─php-fpm(3457)
           └─cron(9876)`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring process tree");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        "command -v pstree >/dev/null 2>&1 && pstree -p || ps auxf"
      );
      expect(result.content[0].text).toContain("Process Tree");
      expect(result.content[0].text).toContain("systemd");
      expect(result.content[0].text).toContain("sshd");
    });

    it("should fallback to ps auxf if pstree not available", async () => {
      const mockOutput = `root         1  0.0  0.1 168916 13312 ?        Ss   Jan01   0:05 /sbin/init
root      1234  0.0  0.2  12345  6789 ?        Ss   Jan01   0:00  \\_ sshd
root      5678  0.0  0.1   8901  4567 pts/0    Ss   10:30   0:00      \\_ bash`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring process tree");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Process Tree");
      expect(result.content[0].text).toContain("init");
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Command failed"));

      const tool = registeredTools.get("monitoring process tree");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error showing process tree");
    });
  });

  describe("monitoring top snapshot", () => {
    it("should get top snapshot with default count", async () => {
      const mockOutput = `top - 10:30:42 up 5 days, 12:34,  2 users,  load average: 0.50, 0.45, 0.40
Tasks: 245 total,   1 running, 244 sleeping,   0 stopped,   0 zombie
%Cpu(s):  3.2 us,  1.1 sy,  0.0 ni, 95.5 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :  32768.0 total,  20480.0 free,   8192.0 used,   4096.0 buff/cache
MiB Swap:   8192.0 total,   8192.0 free,      0.0 used.  24576.0 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
 1234 www-data  20   0  256789  45678  12345 S   5.2   2.3   1:23.45 nginx
 5678 mysql     20   0 1024000  98765  23456 S   2.1   8.5  12:34.56 mysqld`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring top snapshot");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith("top -b -n 1 | head -n 27");
      expect(result.content[0].text).toContain("Top Processes Snapshot");
      expect(result.content[0].text).toContain("20 processes");
      expect(result.content[0].text).toContain("load average");
      expect(result.content[0].text).toContain("nginx");
    });

    it("should respect custom count parameter", async () => {
      const mockOutput = `top - 10:30:42 up 5 days, 12:34,  2 users,  load average: 0.50, 0.45, 0.40
Tasks: 245 total,   1 running, 244 sleeping,   0 stopped,   0 zombie
%Cpu(s):  3.2 us,  1.1 sy,  0.0 ni, 95.5 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :  32768.0 total,  20480.0 free,   8192.0 used,   4096.0 buff/cache
MiB Swap:   8192.0 total,   8192.0 free,      0.0 used.  24576.0 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
 1234 www-data  20   0  256789  45678  12345 S   5.2   2.3   1:23.45 nginx`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring top snapshot");
      const result = await tool.handler({ count: 10 });

      expect(mockSSHExecutor).toHaveBeenCalledWith("top -b -n 1 | head -n 17");
      expect(result.content[0].text).toContain("10 processes");
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("top command failed"));

      const tool = registeredTools.get("monitoring top snapshot");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error getting top snapshot");
    });
  });

  describe("monitoring iostat snapshot", () => {
    it("should get I/O statistics when iostat is available", async () => {
      const mockOutput = `Linux 5.15.0-unraid (unraid)   01/01/2025  _x86_64_    (8 CPU)

avg-cpu:  %user   %nice %system %iowait  %steal   %idle
           3.24    0.00    1.12    0.15    0.00   95.49

Device            r/s     w/s     rkB/s     wkB/s   rrqm/s   wrqm/s  %rrqm  %wrqm r_await w_await aqu-sz rareq-sz wareq-sz  svctm  %util
sda              5.23   15.67    123.45    456.78     0.12     2.34   2.24  13.01    1.23    3.45   0.05    23.61    29.13   0.45   2.87
sdb              2.15    8.92     78.90    234.56     0.05     1.23   2.27  12.10    1.45    2.89   0.03    36.70    26.31   0.38   1.45`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring iostat snapshot");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        "command -v iostat >/dev/null 2>&1 && iostat -x 1 1 || echo 'iostat not available. Install sysstat package.'"
      );
      expect(result.content[0].text).toContain("Disk I/O Statistics");
      expect(result.content[0].text).toContain("sda");
      expect(result.content[0].text).toContain("sdb");
      expect(result.content[0].text).toContain("%util");
    });

    it("should show message when iostat is not available", async () => {
      const mockOutput = "iostat not available. Install sysstat package.";

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring iostat snapshot");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Disk I/O Statistics");
      expect(result.content[0].text).toContain("iostat not available");
      expect(result.content[0].text).toContain("sysstat");
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Command execution failed"));

      const tool = registeredTools.get("monitoring iostat snapshot");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error getting I/O statistics");
    });
  });

  describe("monitoring network connections", () => {
    it("should show all connections by default", async () => {
      const mockOutput = `Netid  State   Recv-Q  Send-Q   Local Address:Port    Peer Address:Port   Process
tcp    LISTEN  0       128          0.0.0.0:22           0.0.0.0:*       users:(("sshd",pid=1234,fd=3))
tcp    ESTAB   0       0            10.0.0.2:22          10.0.0.1:54321  users:(("sshd",pid=5678,fd=4))
tcp    LISTEN  0       128          0.0.0.0:80           0.0.0.0:*       users:(("nginx",pid=9012,fd=6))
udp    UNCONN  0       0            0.0.0.0:53           0.0.0.0:*       users:(("dnsmasq",pid=3456,fd=5))`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring network connections");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        "command -v ss >/dev/null 2>&1 && ss -tunap || netstat -tunap"
      );
      expect(result.content[0].text).toContain("Network Connections");
      expect(result.content[0].text).toContain("sshd");
      expect(result.content[0].text).toContain("nginx");
      expect(result.content[0].text).toContain("LISTEN");
      expect(result.content[0].text).toContain("ESTAB");
    });

    it("should show only listening ports when requested", async () => {
      const mockOutput = `Netid  State   Recv-Q  Send-Q   Local Address:Port    Peer Address:Port   Process
tcp    LISTEN  0       128          0.0.0.0:22           0.0.0.0:*       users:(("sshd",pid=1234,fd=3))
tcp    LISTEN  0       128          0.0.0.0:80           0.0.0.0:*       users:(("nginx",pid=9012,fd=6))
udp    UNCONN  0       0            0.0.0.0:53           0.0.0.0:*       users:(("dnsmasq",pid=3456,fd=5))`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring network connections");
      const result = await tool.handler({ listening: true });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        "command -v ss >/dev/null 2>&1 && ss -tulnp || netstat -tulnp"
      );
      expect(result.content[0].text).toContain("Network Connections (listening only)");
      expect(result.content[0].text).toContain("LISTEN");
    });

    it("should fallback to netstat if ss is not available", async () => {
      const mockOutput = `Active Internet connections (servers and established)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      1234/sshd
tcp        0      0 10.0.0.2:22             10.0.0.1:54321          ESTABLISHED 5678/sshd
tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN      9012/nginx`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("monitoring network connections");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Network Connections");
      expect(result.content[0].text).toContain("sshd");
      expect(result.content[0].text).toContain("nginx");
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("monitoring network connections");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error getting network connections");
      expect(result.content[0].text).toContain("Permission denied");
    });

    it("should handle empty output", async () => {
      mockSSHExecutor.mockResolvedValue("");

      const tool = registeredTools.get("monitoring network connections");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Network Connections");
      expect(result.isError).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("all tools should handle string errors", async () => {
      mockSSHExecutor.mockRejectedValue("Generic error string");

      for (const [name, tool] of registeredTools) {
        const result = await tool.handler({});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Error");
      }
    });

    it("all tools should handle Error objects", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Test error"));

      for (const [name, tool] of registeredTools) {
        const result = await tool.handler({});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Test error");
      }
    });
  });

  describe("Schema Validation", () => {
    it("ps_list should only accept valid sortBy values", () => {
      const tool = registeredTools.get("monitoring ps list");
      const sortBySchema = tool.schema.sortBy;

      expect(sortBySchema).toBeDefined();
      expect(sortBySchema._def.typeName).toBe("ZodOptional");
    });

    it("top_snapshot should have positive integer count", () => {
      const tool = registeredTools.get("monitoring top snapshot");
      const countSchema = tool.schema.count;

      expect(countSchema).toBeDefined();
      expect(countSchema._def.typeName).toBe("ZodDefault");
    });

    it("network_connections should have boolean listening parameter", () => {
      const tool = registeredTools.get("monitoring network connections");
      const listeningSchema = tool.schema.listening;

      expect(listeningSchema).toBeDefined();
      expect(listeningSchema._def.typeName).toBe("ZodOptional");
    });
  });
});
