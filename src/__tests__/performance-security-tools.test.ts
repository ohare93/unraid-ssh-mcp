import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPerformanceSecurityTools } from "../performance-security-tools.js";

describe("Performance and Security Tools", () => {
  let mockServer: McpServer;
  let mockSshExecutor: Mock;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    registeredTools = new Map();
    mockServer = {
      tool: vi.fn((name: string, description: string, schema: any, handler: any) => {
        registeredTools.set(name, { description, schema, handler });
      }),
    } as any;
    mockSshExecutor = vi.fn();

    registerPerformanceSecurityTools(mockServer, mockSshExecutor);
  });

  describe("Tool Registration", () => {
    it("should register all 7 performance and security tools", () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(7);
      expect(registeredTools.has("performance identify bottleneck")).toBe(true);
      expect(registeredTools.has("performance network bandwidth by container")).toBe(true);
      expect(registeredTools.has("performance track metric over time")).toBe(true);
      expect(registeredTools.has("security check open ports")).toBe(true);
      expect(registeredTools.has("security audit container privileges")).toBe(true);
      expect(registeredTools.has("security check ssh connections")).toBe(true);
      expect(registeredTools.has("security check cert expiry")).toBe(true);
    });

    it("should register tools with correct descriptions", () => {
      expect(registeredTools.get("performance identify bottleneck").description).toContain("bottleneck");
      expect(registeredTools.get("performance network bandwidth by container").description).toContain("network bandwidth");
      expect(registeredTools.get("performance track metric over time").description).toContain("time series");
      expect(registeredTools.get("security check open ports").description).toContain("open ports");
      expect(registeredTools.get("security audit container privileges").description).toContain("privileges");
      expect(registeredTools.get("security check ssh connections").description).toContain("SSH");
      expect(registeredTools.get("security check cert expiry").description).toContain("certificate");
    });
  });

  describe("performance identify bottleneck", () => {
    it("should analyze system for CPU bottleneck", async () => {
      const mockOutput = `
Cpu(s):  5.2%us,  2.1%sy,  0.0%ni, 15.3%id,  75.0%wa,  0.0%hi,  2.4%si,  0.0%st
iostat not available
load average: 1.50, 1.20, 0.90
              total        used        free
Mem:           8000        6000        2000
`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance identify bottleneck");
      const result = await tool.handler({});

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("top -b"));
      expect(result.content[0].text).toContain("Bottleneck Analysis");
      expect(result.content[0].text).toContain("Disk I/O");
      expect(result.content[0].text).toContain("Suggestions");
    });

    it("should detect high CPU usage", async () => {
      const mockOutput = `
Cpu(s): 85.2%us,  5.1%sy,  0.0%ni,  5.3%id,  2.0%wa,  0.0%hi,  2.4%si,  0.0%st
iostat not available
load average: 4.50, 4.20, 3.90
`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance identify bottleneck");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("CPU");
    });

    it("should detect system overload", async () => {
      const mockOutput = `
Cpu(s): 45.2%us,  5.1%sy,  0.0%ni, 45.3%id,  2.0%wa,  0.0%hi,  2.4%si,  0.0%st
iostat not available
load average: 8.50, 7.20, 6.90
`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance identify bottleneck");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("System Overload");
    });

    it("should handle no bottleneck detected", async () => {
      const mockOutput = `
Cpu(s):  5.2%us,  2.1%sy,  0.0%ni, 90.3%id,  2.0%wa,  0.0%hi,  0.4%si,  0.0%st
iostat not available
load average: 0.50, 0.40, 0.30
`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance identify bottleneck");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("None detected");
      expect(result.content[0].text).toContain("performing normally");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("SSH connection failed"));

      const tool = registeredTools.get("performance identify bottleneck");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error analyzing bottlenecks");
    });
  });

  describe("performance network bandwidth by container", () => {
    it("should show network bandwidth per container", async () => {
      const mockOutput = `
CONTAINER           NAME                NETWORK I/O
abc123              nginx               1.2MB / 500KB
def456              postgres            800KB / 300KB

=== Network Interface Stats ===
eth0: 1000000 bytes
`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance network bandwidth by container");
      const result = await tool.handler({});

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("docker stats"));
      expect(result.content[0].text).toContain("Network Bandwidth");
      expect(result.content[0].text).toContain("nginx");
      expect(result.content[0].text).toContain("Network Interface Stats");
    });

    it("should handle docker not available", async () => {
      const mockOutput = "Docker not available\n\n=== Network Interface Stats ===\neth0: 0 bytes";
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance network bandwidth by container");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Docker not available");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("Command failed"));

      const tool = registeredTools.get("performance network bandwidth by container");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error getting network bandwidth");
    });
  });

  describe("performance track metric over time", () => {
    it("should track CPU metric over time", async () => {
      const mockOutput = `2025-09-30 10:00:00,25.5
2025-09-30 10:00:05,28.3
2025-09-30 10:00:10,26.1
2025-09-30 10:00:15,30.2
2025-09-30 10:00:20,27.8
2025-09-30 10:00:25,29.5`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance track metric over time");
      const result = await tool.handler({
        metric: "cpu",
        durationSeconds: 30,
        intervalSeconds: 5,
      });

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("for i in"));
      expect(result.content[0].text).toContain("Metric Tracking: cpu");
      expect(result.content[0].text).toContain("Duration: 30s");
      expect(result.content[0].text).toContain("Interval: 5s");
      expect(result.content[0].text).toContain("2025-09-30 10:00:00,25.5");
    });

    it("should track memory metric over time", async () => {
      const mockOutput = `2025-09-30 10:00:00,45.50
2025-09-30 10:00:05,46.20`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance track metric over time");
      const result = await tool.handler({
        metric: "memory",
        durationSeconds: 10,
        intervalSeconds: 5,
      });

      expect(result.content[0].text).toContain("Metric Tracking: memory");
      expect(result.content[0].text).toContain("45.50");
    });

    it("should track disk metric over time", async () => {
      const mockOutput = `2025-09-30 10:00:00,65
2025-09-30 10:00:05,65`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("performance track metric over time");
      const result = await tool.handler({
        metric: "disk",
        durationSeconds: 10,
        intervalSeconds: 5,
      });

      expect(result.content[0].text).toContain("Metric Tracking: disk");
      expect(result.content[0].text).toContain("65");
    });

    it("should use default values for duration and interval", async () => {
      mockSshExecutor.mockResolvedValue("2025-09-30 10:00:00,50");

      const tool = registeredTools.get("performance track metric over time");
      const result = await tool.handler({ metric: "cpu" });

      expect(result.content[0].text).toContain("Duration: 30s");
      expect(result.content[0].text).toContain("Interval: 5s");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("Timeout"));

      const tool = registeredTools.get("performance track metric over time");
      const result = await tool.handler({ metric: "cpu" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error tracking metric");
    });
  });

  describe("security check open ports", () => {
    it("should list open ports using ss", async () => {
      const mockOutput = `=== Listening Ports (ss) ===
State    Recv-Q   Send-Q   Local Address:Port   Peer Address:Port
LISTEN   0        128      0.0.0.0:22            0.0.0.0:*       users:(("sshd",pid=1234))
LISTEN   0        128      0.0.0.0:80            0.0.0.0:*       users:(("nginx",pid=5678))

=== Summary by Port ===
  1 22
  1 80`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check open ports");
      const result = await tool.handler({});

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("ss -tulnp"));
      expect(result.content[0].text).toContain("Open Ports Security Audit");
      expect(result.content[0].text).toContain("22");
      expect(result.content[0].text).toContain("80");
      expect(result.content[0].text).toContain("sshd");
    });

    it("should fallback to netstat if ss not available", async () => {
      const mockOutput = `=== Listening Ports (netstat) ===
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      1234/sshd`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check open ports");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("netstat");
      expect(result.content[0].text).toContain("22");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("security check open ports");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error checking open ports");
    });
  });

  describe("security audit container privileges", () => {
    it("should audit container privileges", async () => {
      const mockOutput = `=== Privileged Container Audit ===

Container: nginx
  Privileged: false
  Network Mode: bridge
  PID Mode:
  Added Capabilities: []

Container: postgres
  Privileged: true
  Network Mode: host
  PID Mode: host
  Added Capabilities: [SYS_ADMIN]
  WARNING: Container is running in privileged mode!
  WARNING: Container is using host network!
  WARNING: Container is using host PID namespace!

=== Summary ===
Privileged containers:
  - postgres`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security audit container privileges");
      const result = await tool.handler({});

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("docker inspect"));
      expect(result.content[0].text).toContain("Privileged Container Audit");
      expect(result.content[0].text).toContain("nginx");
      expect(result.content[0].text).toContain("WARNING");
      expect(result.content[0].text).toContain("postgres");
    });

    it("should handle no running containers", async () => {
      const mockOutput = `=== Privileged Container Audit ===

No running containers found`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security audit container privileges");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No running containers");
    });

    it("should handle docker not available", async () => {
      const mockOutput = "Docker not available";
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security audit container privileges");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Docker not available");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("Docker daemon not running"));

      const tool = registeredTools.get("security audit container privileges");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error auditing container privileges");
    });
  });

  describe("security check ssh connections", () => {
    it("should show active SSH sessions", async () => {
      const mockOutput = `=== Active SSH Sessions ===
 10:30:01 up 5 days,  2:15,  2 users,  load average: 0.50, 0.40, 0.30
USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT
root     pts/0    192.168.1.100    09:00    1:30   0.10s  0.05s -bash
user2    pts/1    192.168.1.101    10:15    0.00s  0.05s  0.01s w

=== All Logged-in Users ===
root     pts/0        2025-09-30 09:00 (192.168.1.100)
user2    pts/1        2025-09-30 10:15 (192.168.1.101)

=== Last Logins ===
user2    pts/1        192.168.1.101    Mon Sep 30 10:15   still logged in
root     pts/0        192.168.1.100    Mon Sep 30 09:00   still logged in

=== Failed Login Attempts ===
No failed attempts in auth.log`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check ssh connections");
      const result = await tool.handler({});

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("w"));
      expect(result.content[0].text).toContain("SSH Connection Audit");
      expect(result.content[0].text).toContain("Active SSH Sessions");
      expect(result.content[0].text).toContain("192.168.1.100");
      expect(result.content[0].text).toContain("Failed Login Attempts");
    });

    it("should show failed login attempts", async () => {
      const mockOutput = `=== Active SSH Sessions ===
user1    pts/0

=== All Logged-in Users ===
user1    pts/0

=== Last Logins ===
user1    pts/0

=== Failed Login Attempts ===
Sep 30 08:00:01 server sshd[1234]: Failed password for invalid user admin from 1.2.3.4 port 12345 ssh2
Sep 30 08:05:23 server sshd[1235]: Failed password for root from 5.6.7.8 port 54321 ssh2`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check ssh connections");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Failed password");
      expect(result.content[0].text).toContain("1.2.3.4");
    });

    it("should handle no active connections", async () => {
      const mockOutput = `=== Active SSH Sessions ===
 10:30:01 up 5 days,  2:15,  0 users,  load average: 0.50, 0.40, 0.30

=== All Logged-in Users ===

=== Last Logins ===

=== Failed Login Attempts ===
Auth logs not accessible or not found`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check ssh connections");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("0 users");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("security check ssh connections");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error checking SSH connections");
    });
  });

  describe("security check cert expiry", () => {
    it("should check specific certificate", async () => {
      const mockOutput = `=== Certificate: /etc/ssl/certs/example.crt ===
Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number: 12345

Expiration Date:
notAfter=Dec 31 23:59:59 2025 GMT

Subject:
subject=CN=example.com`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({ certPath: "/etc/ssl/certs/example.crt" });

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("/etc/ssl/certs/example.crt"));
      expect(result.content[0].text).toContain("SSL Certificate Expiration Check");
      expect(result.content[0].text).toContain("example.crt");
      expect(result.content[0].text).toContain("2025 GMT");
    });

    it("should check common certificate locations", async () => {
      const mockOutput = `=== SSL Certificate Expiration Check ===

Certificate: /etc/ssl/certs/server.crt
  Expires: Dec 31 23:59:59 2025 GMT
  Days until expiry: 90
  Subject: CN=server.example.com

Certificate: /etc/nginx/ssl/nginx.crt
  Expires: Jan 15 23:59:59 2026 GMT
  Days until expiry: 105
  Subject: CN=nginx.example.com`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({});

      expect(mockSshExecutor).toHaveBeenCalledWith(expect.stringContaining("cert_paths"));
      expect(result.content[0].text).toContain("server.crt");
      expect(result.content[0].text).toContain("nginx.crt");
      expect(result.content[0].text).toContain("Days until expiry");
    });

    it("should warn about expiring certificates", async () => {
      const mockOutput = `=== SSL Certificate Expiration Check ===

Certificate: /etc/ssl/certs/expiring.crt
  Expires: Oct 10 23:59:59 2025 GMT
  Days until expiry: 10
  WARNING: Certificate expires in less than 30 days!
  Subject: CN=expiring.example.com`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("WARNING");
      expect(result.content[0].text).toContain("expires in less than 30 days");
    });

    it("should handle no certificates found", async () => {
      const mockOutput = `=== SSL Certificate Expiration Check ===

No certificates found in common locations.
Use certPath parameter to check a specific certificate.`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No certificates found");
    });

    it("should handle certificate file not found", async () => {
      const mockOutput = "Certificate file not found: /path/to/missing.crt";
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({ certPath: "/path/to/missing.crt" });

      expect(result.content[0].text).toContain("Certificate file not found");
    });

    it("should handle openssl not available", async () => {
      const mockOutput = `=== SSL Certificate Expiration Check ===

No certificates found in common locations.

WARNING: openssl command not found. Install openssl to check certificates.`;
      mockSshExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("openssl command not found");
    });

    it("should handle errors gracefully", async () => {
      mockSshExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("security check cert expiry");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error checking certificate expiry");
    });
  });
});
