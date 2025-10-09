import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPluginConfigTools } from "../plugin-config-tools.js";

describe("Plugin Config Tools", () => {
  let server: McpServer;
  let mockSSHExecutor: ReturnType<typeof vi.fn>;
  let registeredTools: Map<
    string,
    {
      description: string;
      schema: any;
      handler: (args: any) => Promise<any>;
    }
  >;

  beforeEach(() => {
    registeredTools = new Map();
    mockSSHExecutor = vi.fn();

    server = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredTools.set(name, { description, schema, handler });
      }),
    } as any;

    registerPluginConfigTools(server, mockSSHExecutor);
  });

  describe("plugin list plugins", () => {
    it("should register list_plugins tool", () => {
      expect(registeredTools.has("plugin list plugins")).toBe(true);
      const tool = registeredTools.get("plugin list plugins")!;
      expect(tool.description).toContain("List all installed Unraid plugins");
    });

    it("should list plugins with versions", async () => {
      const pluginOutput = `dynamix.cache.dirs|2023.12.10|/boot/config/plugins/dynamix.cache.dirs/dynamix.cache.dirs.plg
user.scripts|2023.11.15|/boot/config/plugins/user.scripts/user.scripts.plg
dockerMan|2023.10.20|/boot/config/plugins/dockerMan/dockerMan.plg`;

      mockSSHExecutor.mockResolvedValue(pluginOutput);

      const tool = registeredTools.get("plugin list plugins")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("dynamix.cache.dirs");
      expect(result.content[0].text).toContain("2023.12.10");
      expect(result.content[0].text).toContain("user.scripts");
      expect(result.content[0].text).toContain("dockerMan");
    });

    it("should handle no plugins found", async () => {
      mockSSHExecutor.mockResolvedValue("");

      const tool = registeredTools.get("plugin list plugins")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No plugins found");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Connection failed"));

      const tool = registeredTools.get("plugin list plugins")!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to list plugins");
      expect(result.content[0].text).toContain("Connection failed");
    });
  });

  describe("plugin check plugin updates", () => {
    it("should register check_plugin_updates tool", () => {
      expect(registeredTools.has("plugin check plugin updates")).toBe(true);
      const tool = registeredTools.get("plugin check plugin updates")!;
      expect(tool.description).toContain("Check for available plugin updates");
    });

    it("should list plugin update information", async () => {
      const updateOutput = `dynamix.cache.dirs|2023.12.10|https://raw.githubusercontent.com/author/plugin/master/plugin.plg
user.scripts|2023.11.15|https://raw.githubusercontent.com/author/scripts/master/scripts.plg
dockerMan|2023.10.20|none`;

      mockSSHExecutor.mockResolvedValue(updateOutput);

      const tool = registeredTools.get("plugin check plugin updates")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("dynamix.cache.dirs");
      expect(result.content[0].text).toContain("Current Version: 2023.12.10");
      expect(result.content[0].text).toContain("Update URL:");
      expect(result.content[0].text).toContain("Update Check: Available");
      expect(result.content[0].text).toContain("dockerMan");
      expect(result.content[0].text).toContain("Update Check: Not configured");
    });

    it("should handle no plugin files found", async () => {
      mockSSHExecutor.mockResolvedValue("");

      const tool = registeredTools.get("plugin check plugin updates")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No plugin files found");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("plugin check plugin updates")!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to check plugin updates");
    });
  });

  describe("plugin read docker template", () => {
    it("should register read_docker_template tool", () => {
      expect(registeredTools.has("plugin read docker template")).toBe(true);
      const tool = registeredTools.get("plugin read docker template")!;
      expect(tool.description).toContain("Read and parse a Docker template XML");
    });

    it("should read template file", async () => {
      const templateContent = `<?xml version="1.0"?>
<Container version="2">
  <Name>my-container</Name>
  <Repository>nginx</Repository>
  <Network>bridge</Network>
  <WebUI>http://[IP]:[PORT:8080]/</WebUI>
</Container>`;

      mockSSHExecutor.mockResolvedValue(templateContent);

      const tool = registeredTools.get("plugin read docker template")!;
      const result = await tool.handler({ template: "my-container" });

      expect(result.content[0].text).toContain("<Container version=\"2\">");
      expect(result.content[0].text).toContain("<Name>my-container</Name>");
      expect(result.content[0].text).toContain("<Repository>nginx</Repository>");
    });

    it("should add .xml extension if not provided", async () => {
      mockSSHExecutor.mockResolvedValue("<Container></Container>");

      const tool = registeredTools.get("plugin read docker template")!;
      await tool.handler({ template: "nginx" });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("nginx.xml")
      );
    });

    it("should handle template not found", async () => {
      const notFoundOutput = `Template not found. Available templates:
plex.xml
nginx.xml
pihole.xml`;

      mockSSHExecutor.mockResolvedValue(notFoundOutput);

      const tool = registeredTools.get("plugin read docker template")!;
      const result = await tool.handler({ template: "nonexistent" });

      expect(result.content[0].text).toContain("Template not found");
      expect(result.content[0].text).toContain("Available templates:");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("File read error"));

      const tool = registeredTools.get("plugin read docker template")!;
      const result = await tool.handler({ template: "test" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to read Docker template");
    });
  });

  describe("plugin list user scripts", () => {
    it("should register list_user_scripts tool", () => {
      expect(registeredTools.has("plugin list user scripts")).toBe(true);
      const tool = registeredTools.get("plugin list user scripts")!;
      expect(tool.description).toContain("List all user scripts");
    });

    it("should list user scripts with details", async () => {
      const scriptsOutput = `SCRIPT:backup-script
EXISTS:yes
SCHEDULE:*/15 * * * *
LASTRUN:2023-12-01 10:30:00
DESCRIPTION:Daily backup script
---
SCRIPT:cleanup-logs
EXISTS:yes
SCHEDULE:0 2 * * *
LASTRUN:2023-12-01 02:00:00
DESCRIPTION:Clean old logs
---`;

      mockSSHExecutor.mockResolvedValue(scriptsOutput);

      const tool = registeredTools.get("plugin list user scripts")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("backup-script");
      expect(result.content[0].text).toContain("Exists: yes");
      expect(result.content[0].text).toContain("Schedule: */15 * * * *");
      expect(result.content[0].text).toContain("Last Run: 2023-12-01 10:30:00");
      expect(result.content[0].text).toContain("Description: Daily backup script");
      expect(result.content[0].text).toContain("cleanup-logs");
    });

    it("should handle no scripts found", async () => {
      mockSSHExecutor.mockResolvedValue("");

      const tool = registeredTools.get("plugin list user scripts")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No user scripts found");
    });

    it("should handle user.scripts plugin not installed", async () => {
      mockSSHExecutor.mockResolvedValue("User scripts directory not found");

      const tool = registeredTools.get("plugin list user scripts")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No user scripts found");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Directory access error"));

      const tool = registeredTools.get("plugin list user scripts")!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to list user scripts");
    });
  });

  describe("plugin check share config", () => {
    it("should register check_share_config tool", () => {
      expect(registeredTools.has("plugin check share config")).toBe(true);
      const tool = registeredTools.get("plugin check share config")!;
      expect(tool.description).toContain("Validate share configurations");
    });

    it("should check specific share configuration", async () => {
      const shareOutput = `=== Share: appdata ===

shareName=appdata
shareComment=Application Data
shareSplitLevel=2
shareAllocator=highwater
shareUseCache=prefer
shareInclude=disk1,disk2,disk3

---`;

      mockSSHExecutor.mockResolvedValue(shareOutput);

      const tool = registeredTools.get("plugin check share config")!;
      const result = await tool.handler({ share: "appdata" });

      expect(result.content[0].text).toContain("Share: appdata");
      expect(result.content[0].text).toContain("shareSplitLevel=2");
      expect(result.content[0].text).toContain("shareAllocator=highwater");
      expect(result.content[0].text).toContain("shareUseCache=prefer");
    });

    it("should check all shares when no specific share provided", async () => {
      const allSharesOutput = `=== Share: appdata ===

shareName=appdata
shareSplitLevel=2

---

=== Share: media ===

shareName=media
shareSplitLevel=1

---`;

      mockSSHExecutor.mockResolvedValue(allSharesOutput);

      const tool = registeredTools.get("plugin check share config")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Share: appdata");
      expect(result.content[0].text).toContain("Share: media");
    });

    it("should detect invalid split level", async () => {
      const warningOutput = `=== Share: test ===

shareSplitLevel=abc
  ⚠ WARNING: Split level should be numeric

---`;

      mockSSHExecutor.mockResolvedValue(warningOutput);

      const tool = registeredTools.get("plugin check share config")!;
      const result = await tool.handler({ share: "test" });

      expect(result.content[0].text).toContain("WARNING: Split level should be numeric");
    });

    it("should detect invalid allocator method", async () => {
      const warningOutput = `=== Share: test ===

shareAllocator=invalid
  ⚠ WARNING: Unknown allocator method: invalid

---`;

      mockSSHExecutor.mockResolvedValue(warningOutput);

      const tool = registeredTools.get("plugin check share config")!;
      const result = await tool.handler({ share: "test" });

      expect(result.content[0].text).toContain("WARNING: Unknown allocator method");
    });

    it("should handle share not found", async () => {
      mockSSHExecutor.mockResolvedValue("No share configuration files found");

      const tool = registeredTools.get("plugin check share config")!;
      const result = await tool.handler({ share: "nonexistent" });

      expect(result.content[0].text).toContain("Share configuration not found");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Config read error"));

      const tool = registeredTools.get("plugin check share config")!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to check share configuration");
    });
  });

  describe("plugin check disk assignments", () => {
    it("should register check_disk_assignments tool", () => {
      expect(registeredTools.has("plugin check disk assignments")).toBe(true);
      const tool = registeredTools.get("plugin check disk assignments")!;
      expect(tool.description).toContain("Verify disk assignments");
    });

    it("should show disk assignments", async () => {
      const diskOutput = `=== Disk Assignments ===

Parity/Array Disk 0: WDC_WD100EMAZ-00WJTA0_1234ABCD
Parity/Array Disk 1: TOSHIBA_HDWD120_5678EFGH
Cache Disk 0: Samsung_SSD_860_EVO_500GB_S3Z9NB0K123456
Flash Drive: SanDisk_Cruzer_Fit_0123456789ABCDEF

=== Summary ===
Parity/Array Disks: 2
Cache Disks: 1`;

      mockSSHExecutor.mockResolvedValue(diskOutput);

      const tool = registeredTools.get("plugin check disk assignments")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Disk Assignments");
      expect(result.content[0].text).toContain("Parity/Array Disk");
      expect(result.content[0].text).toContain("Cache Disk");
      expect(result.content[0].text).toContain("Flash Drive");
      expect(result.content[0].text).toContain("Parity/Array Disks: 2");
      expect(result.content[0].text).toContain("Cache Disks: 1");
    });

    it("should handle missing disk.cfg", async () => {
      mockSSHExecutor.mockResolvedValue("ERROR: disk.cfg not found");

      const tool = registeredTools.get("plugin check disk assignments")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("disk.cfg not found");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Permission denied"));

      const tool = registeredTools.get("plugin check disk assignments")!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to check disk assignments");
    });
  });

  describe("plugin find recent changes", () => {
    it("should register find_recent_changes tool", () => {
      expect(registeredTools.has("plugin find recent changes")).toBe(true);
      const tool = registeredTools.get("plugin find recent changes")!;
      expect(tool.description).toContain("Find recently modified configuration files");
    });

    it("should find files modified in last 24 hours", async () => {
      const recentOutput = `=== Files modified in last 24 hours ===
Searching in: /boot/config

-rw-r--r-- 1 root root 1.2K Dec  1 10:30 /boot/config/docker.cfg
-rw-r--r-- 1 root root 456  Dec  1 14:15 /boot/config/shares/appdata.cfg
-rw-r--r-- 1 root root 789  Dec  1 16:45 /boot/config/plugins/dynamix/dynamix.cfg

=== Summary ===
Total files modified: 3`;

      mockSSHExecutor.mockResolvedValue(recentOutput);

      const tool = registeredTools.get("plugin find recent changes")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("Files modified in last 24 hours");
      expect(result.content[0].text).toContain("docker.cfg");
      expect(result.content[0].text).toContain("appdata.cfg");
      expect(result.content[0].text).toContain("Total files modified: 3");
    });

    it("should use custom path", async () => {
      mockSSHExecutor.mockResolvedValue(`=== Files modified in last 24 hours ===
Searching in: /mnt/user/appdata

=== Summary ===
Total files modified: 0`);

      const tool = registeredTools.get("plugin find recent changes")!;
      await tool.handler({ path: "/mnt/user/appdata", hours: 24 });

      expect(mockSSHExecutor).toHaveBeenCalledWith(
        expect.stringContaining("/mnt/user/appdata")
      );
    });

    it("should use custom time period", async () => {
      mockSSHExecutor.mockResolvedValue(`=== Files modified in last 48 hours ===
Searching in: /boot/config

=== Summary ===
Total files modified: 5`);

      const tool = registeredTools.get("plugin find recent changes")!;
      const result = await tool.handler({ hours: 48 });

      expect(result.content[0].text).toContain("48 hours");
    });

    it("should handle no recent changes", async () => {
      mockSSHExecutor.mockResolvedValue(`=== Files modified in last 24 hours ===
Searching in: /boot/config

=== Summary ===
Total files modified: 0`);

      const tool = registeredTools.get("plugin find recent changes")!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain("No files modified in the last 24 hours");
    });

    it("should handle path not found", async () => {
      mockSSHExecutor.mockResolvedValue("ERROR: Path not found: /invalid/path");

      const tool = registeredTools.get("plugin find recent changes")!;
      const result = await tool.handler({ path: "/invalid/path" });

      expect(result.content[0].text).toContain("Path not found");
    });

    it("should handle SSH errors", async () => {
      mockSSHExecutor.mockRejectedValue(new Error("Find command failed"));

      const tool = registeredTools.get("plugin find recent changes")!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Failed to find recent changes");
    });
  });

  describe("Tool Registration", () => {
    it("should register all 7 tools", () => {
      expect(registeredTools.size).toBe(7);
      expect(registeredTools.has("plugin list plugins")).toBe(true);
      expect(registeredTools.has("plugin check plugin updates")).toBe(true);
      expect(registeredTools.has("plugin read docker template")).toBe(true);
      expect(registeredTools.has("plugin list user scripts")).toBe(true);
      expect(registeredTools.has("plugin check share config")).toBe(true);
      expect(registeredTools.has("plugin check disk assignments")).toBe(true);
      expect(registeredTools.has("plugin find recent changes")).toBe(true);
    });

    it("should have proper schema definitions", () => {
      // list_plugins - no parameters
      const listPlugins = registeredTools.get("plugin list plugins")!;
      expect(listPlugins.schema).toBeDefined();

      // check_plugin_updates - no parameters
      const checkUpdates = registeredTools.get("plugin check plugin updates")!;
      expect(checkUpdates.schema).toBeDefined();

      // read_docker_template - requires template
      const readTemplate = registeredTools.get("plugin read docker template")!;
      expect(readTemplate.schema.template).toBeDefined();

      // list_user_scripts - no parameters
      const listScripts = registeredTools.get("plugin list user scripts")!;
      expect(listScripts.schema).toBeDefined();

      // check_share_config - optional share parameter
      const checkShare = registeredTools.get("plugin check share config")!;
      expect(checkShare.schema.share).toBeDefined();

      // check_disk_assignments - no parameters
      const checkDisks = registeredTools.get("plugin check disk assignments")!;
      expect(checkDisks.schema).toBeDefined();

      // find_recent_changes - optional path and hours
      const findChanges = registeredTools.get("plugin find recent changes")!;
      expect(findChanges.schema.path).toBeDefined();
      expect(findChanges.schema.hours).toBeDefined();
    });
  });
});
