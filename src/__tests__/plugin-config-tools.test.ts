import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerUnraidPluginTools as registerPluginConfigTools } from '../platforms/unraid/plugin-tools.js';

describe('Plugin Config Tools', () => {
  let mockServer: any;
  let mockSSHExecutor: any;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    registeredTools = new Map();
    mockServer = {
      tool: vi.fn((name, description, schema, handler) => {
        registeredTools.set(name, { name, description, schema, handler });
      }),
    };
    mockSSHExecutor = vi.fn();
    registerPluginConfigTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 7 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('plugin')).toBe(true);
    });
  });

  describe('action=list', () => {
    it('should list plugins', async () => {
      mockSSHExecutor.mockResolvedValue('plugin1|1.0|/boot/config/plugins/plugin1/plugin1.plg');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'list' });
      expect(result.content[0].text).toContain('Plugins');
    });
  });

  describe('action=updates', () => {
    it('should check plugin updates', async () => {
      mockSSHExecutor.mockResolvedValue('plugin1|1.0|http://example.com/update');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'updates' });
      expect(result.content[0].text).toContain('Plugin Updates');
    });
  });

  describe('action=template', () => {
    it('should require template param', async () => {
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'template' });
      expect(result.isError).toBe(true);
    });

    it('should read template', async () => {
      mockSSHExecutor.mockResolvedValue('<Container>...</Container>');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'template', template: 'plex' });
      expect(result.content[0].text).toContain('Container');
    });
  });

  describe('action=scripts', () => {
    it('should list user scripts', async () => {
      mockSSHExecutor.mockResolvedValue('script1|daily|2024-01-01');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'scripts' });
      expect(result.content[0].text).toContain('User Scripts');
    });
  });

  describe('action=share_config', () => {
    it('should check share config', async () => {
      mockSSHExecutor.mockResolvedValue('=== media ===\nshareUseCache=yes\n---');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'share_config' });
      expect(result.content[0].text).toContain('media');
    });
  });

  describe('action=disk_assignments', () => {
    it('should show disk assignments', async () => {
      mockSSHExecutor.mockResolvedValue('=== Disk Assignments ===\ndiskId.0="WD-12345"');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'disk_assignments' });
      expect(result.content[0].text).toContain('Disk Assignments');
    });
  });

  describe('action=recent_changes', () => {
    it('should find recent changes', async () => {
      mockSSHExecutor.mockResolvedValue('=== Files modified in last 24h ===\nfile.cfg\n\nTotal: 1');
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'recent_changes', hours: 24 });
      expect(result.content[0].text).toContain('Files modified');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('plugin');
      const result = await tool.handler({ action: 'list' });
      expect(result.isError).toBe(true);
    });
  });
});
