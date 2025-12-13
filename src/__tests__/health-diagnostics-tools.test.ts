import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerHealthDiagnosticsTools } from '../tools/core/health-diagnostics-tools.js';

describe('Health Diagnostics Tools', () => {
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
    registerHealthDiagnosticsTools(mockServer as any, mockSSHExecutor);
  });

  describe('Tool Registration', () => {
    it('should register 1 mega-tool with 6 actions', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('health')).toBe(true);
    });
  });

  describe('action=comprehensive', () => {
    it('should run comprehensive health check', async () => {
      mockSSHExecutor.mockResolvedValue('OK');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'comprehensive' });
      expect(result.content[0].text).toContain('Health');
    });
  });

  describe('action=common_issues', () => {
    it('should detect common issues', async () => {
      mockSSHExecutor.mockResolvedValue('No issues');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'common_issues' });
      expect(result.content[0].text).toContain('Issues');
    });
  });

  describe('action=threshold_alerts', () => {
    it('should check thresholds', async () => {
      mockSSHExecutor.mockResolvedValue('50% used');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'threshold_alerts', cpuThreshold: 80, memThreshold: 90 });
      expect(result.content[0].text).toContain('Threshold');
    });
  });

  describe('action=compare_baseline', () => {
    it('should compare with baseline', async () => {
      mockSSHExecutor.mockResolvedValue('{}');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'compare_baseline' });
      expect(result.content[0].text).toContain('Baseline');
    });
  });

  describe('action=diagnostic_report', () => {
    it('should generate diagnostic report', async () => {
      mockSSHExecutor.mockResolvedValue('System OK');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'diagnostic_report', format: 'text' });
      expect(result.content[0].text).toContain('Diagnostic');
    });

    it('should support markdown format', async () => {
      mockSSHExecutor.mockResolvedValue('System OK');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'diagnostic_report', format: 'markdown' });
      expect(result.content[0].text).toContain('Diagnostic');
    });
  });

  describe('action=snapshot', () => {
    it('should capture system snapshot', async () => {
      mockSSHExecutor.mockResolvedValue('{}');
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'snapshot', name: 'test' });
      expect(result.content[0].text).toContain('Snapshot');
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully in comprehensive', async () => {
      // comprehensive catches errors internally for each check
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'comprehensive' });
      // Each check catches errors and reports "Unable to check"
      expect(result.content[0].text).toContain('Health Check');
    });

    it('should handle errors gracefully in diagnostic_report', async () => {
      // diagnostic_report also catches errors internally for each section
      mockSSHExecutor.mockRejectedValue(new Error('SSH failed'));
      const tool = registeredTools.get('health');
      const result = await tool.handler({ action: 'diagnostic_report' });
      // Still produces a report with whatever it could gather
      expect(result.content[0].text).toContain('Diagnostic');
    });
  });
});
