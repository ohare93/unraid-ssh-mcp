import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodeSSH } from 'node-ssh';

// Mock node-ssh
vi.mock('node-ssh');

// Mock dotenv
vi.mock('dotenv/config', () => ({}));

describe('SSHConnectionManager', () => {
  let mockSSH: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Set up test environment variables
    process.env.SSH_HOST = 'test-host';
    process.env.SSH_PORT = '22';
    process.env.SSH_USERNAME = 'test-user';
    process.env.SSH_PRIVATE_KEY_PATH = '/path/to/key';

    // Create mock SSH instance
    mockSSH = {
      connect: vi.fn().mockResolvedValue(undefined),
      execCommand: vi.fn().mockResolvedValue({
        stdout: 'test output',
        stderr: '',
        code: 0,
      }),
      dispose: vi.fn(),
    };

    // Mock NodeSSH constructor
    vi.mocked(NodeSSH).mockImplementation(() => mockSSH);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should throw error if SSH_HOST is missing', async () => {
      delete process.env.SSH_HOST;

      // Dynamically import to trigger constructor with new env
      await expect(async () => {
        const { SSHConnectionManager } = await import('../ssh-manager.js');
        new SSHConnectionManager();
      }).rejects.toThrow('SSH_HOST environment variable is required');
    });

    it('should throw error if SSH_USERNAME is missing', async () => {
      delete process.env.SSH_USERNAME;

      await expect(async () => {
        const { SSHConnectionManager } = await import('../ssh-manager.js');
        new SSHConnectionManager();
      }).rejects.toThrow('SSH_USERNAME environment variable is required');
    });

    it('should throw error if neither SSH_PRIVATE_KEY_PATH nor SSH_PASSWORD is provided', async () => {
      delete process.env.SSH_PRIVATE_KEY_PATH;
      delete process.env.SSH_PASSWORD;

      await expect(async () => {
        const { SSHConnectionManager } = await import('../ssh-manager.js');
        new SSHConnectionManager();
      }).rejects.toThrow('Either SSH_PRIVATE_KEY_PATH or SSH_PASSWORD environment variable is required');
    });

    it('should accept SSH_PASSWORD instead of SSH_PRIVATE_KEY_PATH', async () => {
      delete process.env.SSH_PRIVATE_KEY_PATH;
      process.env.SSH_PASSWORD = 'test-password';

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      expect(() => new SSHConnectionManager()).not.toThrow();
    });
  });

  describe('connect', () => {
    it('should connect successfully with private key', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await manager.connect();

      expect(mockSSH.connect).toHaveBeenCalledWith({
        host: 'test-host',
        port: 22,
        username: 'test-user',
        privateKeyPath: '/path/to/key',
      });
      expect(manager.isConnected()).toBe(true);
    });

    it('should connect successfully with password', async () => {
      delete process.env.SSH_PRIVATE_KEY_PATH;
      process.env.SSH_PASSWORD = 'test-password';

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await manager.connect();

      expect(mockSSH.connect).toHaveBeenCalledWith({
        host: 'test-host',
        port: 22,
        username: 'test-user',
        password: 'test-password',
      });
    });

    it('should handle connection failure', async () => {
      mockSSH.connect.mockRejectedValueOnce(new Error('Connection failed'));

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await expect(manager.connect()).rejects.toThrow('Failed to connect to SSH server: Connection failed');
      expect(manager.isConnected()).toBe(false);
    });

    it('should use custom port if provided', async () => {
      process.env.SSH_PORT = '2222';

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await manager.connect();

      expect(mockSSH.connect).toHaveBeenCalledWith(
        expect.objectContaining({ port: 2222 })
      );
    });
  });

  describe('executeCommand', () => {
    it('should execute command successfully', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      const result = await manager.executeCommand('ls -la');

      expect(mockSSH.execCommand).toHaveBeenCalledWith('ls -la');
      expect(result).toEqual({
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
      });
    });

    it('should handle command with stderr', async () => {
      mockSSH.execCommand.mockResolvedValueOnce({
        stdout: '',
        stderr: 'error message',
        code: 1,
      });

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      const result = await manager.executeCommand('failing-command');

      expect(result).toEqual({
        stdout: '',
        stderr: 'error message',
        exitCode: 1,
      });
    });

    it('should auto-connect if not connected', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      const result = await manager.executeCommand('ls');

      expect(mockSSH.connect).toHaveBeenCalled();
      expect(mockSSH.execCommand).toHaveBeenCalledWith('ls');
      expect(result.stdout).toBe('test output');
    });

    it('should handle null exit code', async () => {
      mockSSH.execCommand.mockResolvedValueOnce({
        stdout: 'output',
        stderr: '',
        code: null,
      });

      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      const result = await manager.executeCommand('test');

      expect(result.exitCode).toBe(0);
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();
      await manager.connect();

      await manager.disconnect();

      expect(mockSSH.dispose).toHaveBeenCalled();
      expect(manager.isConnected()).toBe(false);
    });

    it('should not error if already disconnected', async () => {
      const { SSHConnectionManager } = await import('../ssh-manager.js');
      const manager = new SSHConnectionManager();

      await expect(manager.disconnect()).resolves.not.toThrow();
      expect(mockSSH.dispose).not.toHaveBeenCalled();
    });
  });
});
