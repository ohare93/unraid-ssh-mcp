import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSecurityTools } from '../tools/core/security-tools.js';

describe('Security Tools', () => {
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
    registerSecurityTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 4 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('security')).toBe(true);
    });
  });

  describe('action=open_ports', () => {
    it('should list open ports', async () => {
      mockSSHExecutor.mockResolvedValue('=== Listening Ports ===\ntcp 0.0.0.0:22 LISTEN');
      const tool = registeredTools.get('security');
      const result = await tool.handler({ action: 'open_ports' });
      expect(result.content[0].text).toContain('Open Ports');
    });
  });

  describe('action=audit_privileges', () => {
    it('should audit container privileges', async () => {
      mockSSHExecutor.mockResolvedValue('Container: test\n  Privileged: false');
      const tool = registeredTools.get('security');
      const result = await tool.handler({ action: 'audit_privileges' });
      expect(result.content[0].text).toContain('Privilege Audit');
    });
  });

  describe('action=ssh_connections', () => {
    it('should check SSH connections', async () => {
      mockSSHExecutor.mockResolvedValue('=== Active SSH ===\nuser pts/0');
      const tool = registeredTools.get('security');
      const result = await tool.handler({ action: 'ssh_connections' });
      expect(result.content[0].text).toContain('SSH Connections');
    });
  });

  describe('action=cert_expiry', () => {
    it('should check certificate expiry', async () => {
      mockSSHExecutor.mockResolvedValue('notAfter=Jan 1 2025');
      const tool = registeredTools.get('security');
      const result = await tool.handler({ action: 'cert_expiry' });
      expect(result.content[0].text).toContain('Certificate Check');
    });

    it('should check specific certificate path', async () => {
      mockSSHExecutor.mockResolvedValue('notAfter=Jan 1 2025');
      const tool = registeredTools.get('security');
      const result = await tool.handler({ action: 'cert_expiry', certPath: '/etc/ssl/cert.pem' });
      expect(result.content[0].text).toContain('Certificate');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('security');
      const result = await tool.handler({ action: 'open_ports' });
      expect(result.isError).toBe(true);
    });
  });
});
