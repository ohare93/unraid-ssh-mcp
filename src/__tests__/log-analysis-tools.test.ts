import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLogAnalysisTools } from "../log-analysis-tools.js";

describe("Log Analysis Tools", () => {
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
    registerLogAnalysisTools(mockServer as any, mockSSHExecutor);
  });

  describe("Tool Registration", () => {
    it("should register all 6 log analysis tools", () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(6);
      expect(registeredTools.has("log grep all logs")).toBe(true);
      expect(registeredTools.has("log error aggregator")).toBe(true);
      expect(registeredTools.has("log timeline")).toBe(true);
      expect(registeredTools.has("log parse docker logs")).toBe(true);
      expect(registeredTools.has("log compare logs timerange")).toBe(true);
      expect(registeredTools.has("log container restart history")).toBe(true);
    });
  });

  describe("log grep all logs", () => {
    it("should search logs case-insensitively by default", async () => {
      const mockOutput = `=== SYSLOG ===
Jan 15 10:30:15 unraid kernel: Error: disk failure detected
Jan 15 10:32:45 unraid systemd: Failed to start service

=== DOCKER LOGS ===
--- Container: nginx ---
2025-01-15 10:35:22 [error] 123#0: connection refused
--- Container: mysql ---
No matches

=== APPLICATION LOGS ===
--- /var/log/messages ---
Jan 15 10:40:12 unraid app: ERROR: database connection failed`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log grep all logs");
      const result = await tool.handler({ pattern: "error" });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("grep -i");
      expect(command).toContain("/var/log/syslog");
      expect(command).toContain("docker logs");
      expect(result.content[0].text).toContain("Log Search Results");
      expect(result.content[0].text).toContain("case-insensitive");
      expect(result.content[0].text).toContain("disk failure");
      expect(result.isError).toBeUndefined();
    });

    it("should search case-sensitively when requested", async () => {
      const mockOutput = `=== SYSLOG ===
Jan 15 10:30:15 unraid kernel: ERROR: critical failure

=== DOCKER LOGS ===
--- Container: app ---
ERROR: application crashed

=== APPLICATION LOGS ===
No matches in application logs`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log grep all logs");
      const result = await tool.handler({ pattern: "ERROR", caseSensitive: true });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).not.toContain("grep -i");
      expect(command).toContain('grep  "ERROR"');
      expect(result.content[0].text).toContain("case-sensitive");
    });

    it("should handle empty search results", async () => {
      const mockOutput = `=== SYSLOG ===
No matches in syslog

=== DOCKER LOGS ===
--- Container: nginx ---
No matches

=== APPLICATION LOGS ===
No matches in application logs`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log grep all logs");
      const result = await tool.handler({ pattern: "nonexistent" });

      expect(result.content[0].text).toContain("Log Search Results");
      expect(result.content[0].text).toContain("No matches");
      expect(result.isError).toBeUndefined();
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("log grep all logs");
      const result = await tool.handler({ pattern: "error" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error searching logs");
      expect(result.content[0].text).toContain("Permission denied");
    });
  });

  describe("log error aggregator", () => {
    it("should aggregate errors with default parameters", async () => {
      const mockOutput = `=== ERROR SUMMARY (Last 24 hours) ===

     15 [nginx] Error: connection timeout
     12 kernel: disk error on /dev/sda
      8 [mysql] ERROR: deadlock detected
      5 systemd: Failed to start service
      3 [app] Exception: null pointer

=== STATISTICS ===
Total error lines found: 43
Unique error patterns: 5`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log error aggregator");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("24 hours ago");
      expect(command).toContain("grep -iE");
      expect(command).toContain("(error|fail|exception|critical)");
      expect(command).toContain("sort");
      expect(command).toContain("uniq -c");
      expect(result.content[0].text).toContain("Error Aggregation");
      expect(result.content[0].text).toContain("Last 24 hours");
      expect(result.content[0].text).toContain("connection timeout");
      expect(result.isError).toBeUndefined();
    });

    it("should respect custom hours parameter", async () => {
      const mockOutput = `=== ERROR SUMMARY (Last 12 hours) ===

      7 [nginx] Error: connection timeout
      4 kernel: disk error on /dev/sda

=== STATISTICS ===
Total error lines found: 11
Unique error patterns: 2`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log error aggregator");
      const result = await tool.handler({ hours: 12 });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("12 hours ago");
      expect(result.content[0].text).toContain("Last 12 hours");
    });

    it("should filter by minimum count", async () => {
      const mockOutput = `=== ERROR SUMMARY (Last 24 hours) ===

     15 [nginx] Error: connection timeout
     12 kernel: disk error on /dev/sda
      8 [mysql] ERROR: deadlock detected

=== STATISTICS ===
Total error lines found: 35
Unique error patterns: 3`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log error aggregator");
      const result = await tool.handler({ minCount: 5 });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain(">= 5");
      expect(result.content[0].text).toContain("min count: 5");
    });

    it("should handle no errors found", async () => {
      const mockOutput = `=== ERROR SUMMARY (Last 24 hours) ===


=== STATISTICS ===
Total error lines found: 0
Unique error patterns: 0`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log error aggregator");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Error Aggregation");
      expect(result.content[0].text).toContain("Total error lines found: 0");
      expect(result.isError).toBeUndefined();
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Command failed"));

      const tool = registeredTools.get("log error aggregator");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error aggregating errors");
    });
  });

  describe("log timeline", () => {
    it("should create timeline with default hours", async () => {
      const mockOutput = `=== TIMELINE OF SIGNIFICANT EVENTS (Last 24 hours) ===

Jan 15 08:30:12 Started container nginx
Jan 15 09:15:33 docker: Container mysql stopped
Jan 15 10:22:45 kernel: error detected on disk
Jan 15 11:45:12 mover: started moving files
Jan 15 12:30:00 array: parity check started
Container nginx: running (started: 2025-01-15T08:30:12)
Container mysql: exited (started: 2025-01-14T10:15:00)`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log timeline");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("24 hours ago");
      expect(command).toContain("journalctl");
      expect(command).toContain("grep -E");
      expect(command).toContain("(Started|Stopped|Created|Removed|error|fail|mover|array)");
      expect(result.content[0].text).toContain("Event Timeline");
      expect(result.content[0].text).toContain("Last 24 hours");
      expect(result.content[0].text).toContain("Started container nginx");
      expect(result.content[0].text).toContain("parity check");
      expect(result.isError).toBeUndefined();
    });

    it("should respect custom hours parameter", async () => {
      const mockOutput = `=== TIMELINE OF SIGNIFICANT EVENTS (Last 6 hours) ===

Jan 15 14:30:12 Started container app
Jan 15 15:22:45 error detected
Container app: running (started: 2025-01-15T14:30:12)`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log timeline");
      const result = await tool.handler({ hours: 6 });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("6 hours ago");
      expect(result.content[0].text).toContain("Last 6 hours");
    });

    it("should handle empty timeline", async () => {
      const mockOutput = `=== TIMELINE OF SIGNIFICANT EVENTS (Last 24 hours) ===

`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log timeline");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Event Timeline");
      expect(result.isError).toBeUndefined();
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Log access denied"));

      const tool = registeredTools.get("log timeline");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error generating timeline");
    });
  });

  describe("log parse docker logs", () => {
    it("should parse regular text logs", async () => {
      const mockOutput = `2025-01-15 10:30:12 INFO: Application started
2025-01-15 10:30:15 DEBUG: Connected to database
2025-01-15 10:30:20 INFO: Ready to accept connections`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log parse docker logs");
      const result = await tool.handler({ container: "nginx" });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("docker logs");
      expect(command).toContain("--tail 100");
      expect(command).toContain("nginx");
      expect(result.content[0].text).toContain("Docker Logs for \"nginx\"");
      expect(result.content[0].text).toContain("last 100 lines");
      expect(result.content[0].text).toContain("Application started");
      expect(result.isError).toBeUndefined();
    });

    it("should auto-detect and parse JSON logs", async () => {
      const mockOutput = `=== JSON LOGS DETECTED - Pretty-printing ===

{
    "timestamp": "2025-01-15T10:30:12Z",
    "level": "info",
    "message": "Application started"
}
{
    "timestamp": "2025-01-15T10:30:15Z",
    "level": "debug",
    "message": "Connected to database"
}`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log parse docker logs");
      const result = await tool.handler({ container: "app", jsonLines: false });

      expect(result.content[0].text).toContain("JSON LOGS DETECTED");
      expect(result.content[0].text).toContain('"timestamp"');
      expect(result.content[0].text).toContain('"level"');
    });

    it("should force JSON parsing when requested", async () => {
      const mockOutput = `{"timestamp":"2025-01-15T10:30:12Z","level":"info"}
{"timestamp":"2025-01-15T10:30:15Z","level":"error"}`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log parse docker logs");
      const result = await tool.handler({ container: "app", jsonLines: true });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("python3 -m json.tool");
    });

    it("should respect custom lines parameter", async () => {
      const mockOutput = `2025-01-15 10:30:12 INFO: Line 1
2025-01-15 10:30:13 INFO: Line 2`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log parse docker logs");
      const result = await tool.handler({ container: "nginx", lines: 50 });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("--tail 50");
      expect(result.content[0].text).toContain("last 50 lines");
    });

    it("should handle container not found", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("No such container: nonexistent"));

      const tool = registeredTools.get("log parse docker logs");
      const result = await tool.handler({ container: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error parsing docker logs");
      expect(result.content[0].text).toContain("No such container");
    });
  });

  describe("log compare logs timerange", () => {
    it("should compare logs between two times", async () => {
      const mockOutput = `=== EVENTS FROM 2025-01-15 10:00:00 TO 2025-01-15 11:00:00 ===

Jan 15 10:15:32 unraid systemd: Started nginx.service
Jan 15 10:30:45 unraid kernel: disk error detected
Jan 15 10:45:12 unraid docker: Container mysql stopped

=== DOCKER EVENTS IN TIMERANGE ===
2025-01-15T10:15:32 container start nginx
2025-01-15T10:45:12 container stop mysql

=== CONTAINER STATES AT END TIME ===
  nginx: running (started: 2025-01-15T10:15:32)
  mysql: exited (started: 2025-01-14T08:00:00)`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log compare logs timerange");
      const result = await tool.handler({
        startTime: "2025-01-15 10:00:00",
        endTime: "2025-01-15 11:00:00",
      });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("journalctl");
      expect(command).toContain("--since");
      expect(command).toContain("--until");
      expect(command).toContain("docker events");
      expect(result.content[0].text).toContain("Events Between");
      expect(result.content[0].text).toContain("2025-01-15 10:00:00");
      expect(result.content[0].text).toContain("2025-01-15 11:00:00");
      expect(result.content[0].text).toContain("Started nginx.service");
      expect(result.isError).toBeUndefined();
    });

    it("should support relative time formats", async () => {
      const mockOutput = `=== EVENTS FROM 1 hour ago TO now ===

Jan 15 14:30:12 unraid systemd: Started service
Jan 15 14:45:33 unraid docker: Container restarted

=== DOCKER EVENTS IN TIMERANGE ===
2025-01-15T14:30:12 container start app

=== CONTAINER STATES AT END TIME ===
  app: running (started: 2025-01-15T14:30:12)`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log compare logs timerange");
      const result = await tool.handler({
        startTime: "1 hour ago",
        endTime: "now",
      });

      expect(result.content[0].text).toContain("Events Between");
      expect(result.content[0].text).toContain("1 hour ago");
      expect(result.content[0].text).toContain("now");
    });

    it("should handle journalctl not available", async () => {
      const mockOutput = `=== EVENTS FROM 10:00:00 TO 11:00:00 ===

journalctl not available, using syslog...

=== DOCKER EVENTS IN TIMERANGE ===
Could not retrieve docker events for timerange

=== CONTAINER STATES AT END TIME ===
Could not retrieve container states`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log compare logs timerange");
      const result = await tool.handler({
        startTime: "10:00:00",
        endTime: "11:00:00",
      });

      expect(result.content[0].text).toContain("journalctl not available");
      expect(result.isError).toBeUndefined();
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Invalid time format"));

      const tool = registeredTools.get("log compare logs timerange");
      const result = await tool.handler({
        startTime: "invalid",
        endTime: "also-invalid",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error comparing logs in timerange");
    });
  });

  describe("log container restart history", () => {
    it("should show container restart history", async () => {
      const mockOutput = `=== CONTAINER RESTART HISTORY (Last 24 hours) ===

=== DOCKER EVENTS (Restarts) ===
Jan 15 10:30:12 unraid docker: Container nginx restarted
Jan 15 11:45:22 unraid docker: Container mysql restarted

=== CONTAINER RESTART COUNTS ===
Container: nginx
  Status: running
  Restart Count: 2
  Last Started: 2025-01-15T11:50:12
  Last Finished: 2025-01-15T11:45:10
  Exit Code: 1

Container: mysql
  Status: running
  Restart Count: 1
  Last Started: 2025-01-15T11:46:00
  Last Finished: 2025-01-15T11:45:22
  Exit Code: 0

=== RECENT CONTAINER LOGS (Checking for restart causes) ===
--- Logs for nginx (restart count: 2) ---
[error] connection timeout
[error] worker process exited on signal 11
[fatal] segmentation fault

--- Logs for mysql (restart count: 1) ---
[error] InnoDB: Database page corruption`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log container restart history");
      const result = await tool.handler({});

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("24 hours ago");
      expect(command).toContain("journalctl");
      expect(command).toContain("restart");
      expect(command).toContain("docker inspect");
      expect(command).toContain("RestartCount");
      expect(result.content[0].text).toContain("Container Restart History");
      expect(result.content[0].text).toContain("Last 24 hours");
      expect(result.content[0].text).toContain("Restart Count: 2");
      expect(result.content[0].text).toContain("segmentation fault");
      expect(result.isError).toBeUndefined();
    });

    it("should respect custom hours parameter", async () => {
      const mockOutput = `=== CONTAINER RESTART HISTORY (Last 12 hours) ===

=== DOCKER EVENTS (Restarts) ===
Jan 15 14:30:12 unraid docker: Container app restarted

=== CONTAINER RESTART COUNTS ===
Container: app
  Status: running
  Restart Count: 1
  Last Started: 2025-01-15T14:31:00
  Last Finished: 2025-01-15T14:30:12
  Exit Code: 137

=== RECENT CONTAINER LOGS (Checking for restart causes) ===
--- Logs for app (restart count: 1) ---
[fatal] out of memory`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log container restart history");
      const result = await tool.handler({ hours: 12 });

      expect(mockSSHExecutor).toHaveBeenCalled();
      const command = mockSSHExecutor.mock.calls[0][0];
      expect(command).toContain("12 hours ago");
      expect(result.content[0].text).toContain("Last 12 hours");
    });

    it("should handle no restarts found", async () => {
      const mockOutput = `=== CONTAINER RESTART HISTORY (Last 24 hours) ===

=== DOCKER EVENTS (Restarts) ===
No restart events in journalctl

=== CONTAINER RESTART COUNTS ===
Container: nginx
  Status: running
  Restart Count: 0
  Last Started: 2025-01-14T08:00:00
  Last Finished: 0001-01-01T00:00:00
  Exit Code: 0

=== RECENT CONTAINER LOGS (Checking for restart causes) ===
`;

      mockSSHExecutor.mockResolvedValue(mockOutput);

      const tool = registeredTools.get("log container restart history");
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Container Restart History");
      expect(result.content[0].text).toContain("Restart Count: 0");
      expect(result.isError).toBeUndefined();
    });

    it("should handle errors gracefully", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Docker daemon not responding"));

      const tool = registeredTools.get("log container restart history");
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Error getting container restart history");
      expect(result.content[0].text).toContain("Docker daemon not responding");
    });
  });

  describe("Error Handling", () => {
    it("all tools should handle string errors", async () => {
      mockSSHExecutor.mockRejectedValue("Generic error string");

      for (const [name, tool] of registeredTools) {
        const result = await tool.handler({
          pattern: "test",
          container: "test",
          startTime: "now",
          endTime: "now",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Error");
      }
    });

    it("all tools should handle Error objects", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Test error"));

      for (const [name, tool] of registeredTools) {
        const result = await tool.handler({
          pattern: "test",
          container: "test",
          startTime: "now",
          endTime: "now",
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("Test error");
      }
    });
  });

  describe("Schema Validation", () => {
    it("grep_all_logs should have pattern and caseSensitive parameters", () => {
      const tool = registeredTools.get("log grep all logs");
      expect(tool.schema.pattern).toBeDefined();
      expect(tool.schema.caseSensitive).toBeDefined();
    });

    it("error_aggregator should have hours and minCount with defaults", () => {
      const tool = registeredTools.get("log error aggregator");
      expect(tool.schema.hours).toBeDefined();
      expect(tool.schema.hours._def.typeName).toBe("ZodDefault");
      expect(tool.schema.minCount).toBeDefined();
      expect(tool.schema.minCount._def.typeName).toBe("ZodDefault");
    });

    it("log_timeline should have hours parameter with default", () => {
      const tool = registeredTools.get("log timeline");
      expect(tool.schema.hours).toBeDefined();
      expect(tool.schema.hours._def.typeName).toBe("ZodDefault");
    });

    it("parse_docker_logs should have container, jsonLines, and lines parameters", () => {
      const tool = registeredTools.get("log parse docker logs");
      expect(tool.schema.container).toBeDefined();
      expect(tool.schema.jsonLines).toBeDefined();
      expect(tool.schema.lines).toBeDefined();
      expect(tool.schema.lines._def.typeName).toBe("ZodDefault");
    });

    it("compare_logs_timerange should have startTime and endTime parameters", () => {
      const tool = registeredTools.get("log compare logs timerange");
      expect(tool.schema.startTime).toBeDefined();
      expect(tool.schema.endTime).toBeDefined();
    });

    it("container_restart_history should have hours parameter with default", () => {
      const tool = registeredTools.get("log container restart history");
      expect(tool.schema.hours).toBeDefined();
      expect(tool.schema.hours._def.typeName).toBe("ZodDefault");
    });
  });
});
