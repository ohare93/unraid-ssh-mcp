import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

describe('HTTP Server', () => {
  let serverProcess: ChildProcess;
  const testPort = 3999;
  const serverUrl = `http://localhost:${testPort}`;

  beforeAll(async () => {
    // Start the HTTP server in a subprocess
    serverProcess = spawn('tsx', ['src/http-server.ts'], {
      env: {
        ...process.env,
        HTTP_PORT: testPort.toString(),
        SSH_HOST: 'test-host',
        SSH_USERNAME: 'test-user',
        SSH_PASSWORD: 'test-password',
        NODE_ENV: 'test',
      },
    });

    // Wait for server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server failed to start within timeout'));
      }, 10000);

      serverProcess.stderr?.on('data', (data: Buffer) => {
        const message = data.toString();
        if (message.includes(`listening on port ${testPort}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  });

  afterAll(async () => {
    // Stop the server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        serverProcess.on('exit', () => resolve());
        // Force kill after 2 seconds if graceful shutdown fails
        setTimeout(() => {
          serverProcess.kill('SIGKILL');
          resolve();
        }, 2000);
      });
    }
  });

  it('should start and respond to health check', async () => {
    const response = await fetch(`${serverUrl}/health`);

    // Response should be valid JSON even if SSH is not connected
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(600);

    const data = await response.json() as Record<string, any>;
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('server', 'mcp-ssh-unraid');
    expect(data).toHaveProperty('version', '1.1.0');
    expect(data).toHaveProperty('transport', 'http');
    expect(data).toHaveProperty('ssh_connected');

    // Status should be either 'healthy' or 'degraded'
    expect(['healthy', 'degraded']).toContain(data.status);

    // SSH won't connect in test environment, so should be false
    expect(data.ssh_connected).toBe(false);
  });

  it('should have MCP endpoint available', async () => {
    // MCP endpoint should accept POST requests
    const response = await fetch(`${serverUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '1.0.0',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
        id: 1,
      }),
    });

    // Should not return 404
    expect(response.status).not.toBe(404);
  });

  it('should handle CORS', async () => {
    const response = await fetch(`${serverUrl}/health`, {
      headers: {
        'Origin': 'http://example.com',
      },
    });

    // Should have CORS headers
    expect(response.headers.has('access-control-allow-origin')).toBe(true);
  });

  it('should return 404 for unknown endpoints', async () => {
    const response = await fetch(`${serverUrl}/unknown-endpoint`);
    expect(response.status).toBe(404);
  });
});
