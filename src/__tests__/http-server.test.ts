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
      }, 30000); // Increased timeout for platform detection

      let output = '';
      serverProcess.stderr?.on('data', (data: Buffer) => {
        const message = data.toString();
        output += message;
        if (message.includes('Server ready!')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      serverProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}: ${output}`));
        }
      });
    });
  }, 35000); // beforeAll timeout

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
    expect(data).toHaveProperty('server', 'mcp-ssh-sre');
    expect(data).toHaveProperty('version', '2.0.1');
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
          protocolVersion: '1.0.1',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.1',
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

describe('OAuth Authentication Enforcement', () => {
  let authServerProcess: ChildProcess;
  const authPort = 3998;
  const authServerUrl = `http://localhost:${authPort}`;
  let clientId: string;
  let clientSecret: string;
  let accessToken: string;

  beforeAll(async () => {
    // Start server with REQUIRE_AUTH=true
    authServerProcess = spawn('tsx', ['src/http-server.ts'], {
      env: {
        ...process.env,
        HTTP_PORT: authPort.toString(),
        REQUIRE_AUTH: 'true',
        SSH_HOST: 'test-host',
        SSH_USERNAME: 'test-user',
        SSH_PASSWORD: 'test-password',
        NODE_ENV: 'test',
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Auth server start timeout')), 30000);
      let output = '';
      authServerProcess.stderr?.on('data', (data: Buffer) => {
        const message = data.toString();
        output += message;
        if (message.includes('Server ready!')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      authServerProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Auth server exited with code ${code}: ${output}`));
        }
      });
    });

    // Register a client
    const registerResponse = await fetch(`${authServerUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Client' }),
    });
    const clientData = await registerResponse.json() as Record<string, any>;
    clientId = clientData.client_id;
    clientSecret = clientData.client_secret;

    // Get access token - don't follow redirects to extract code
    const authResponse = await fetch(`${authServerUrl}/authorize?client_id=${clientId}&redirect_uri=http://localhost:9999/callback&state=test&response_type=code`, {
      redirect: 'manual'
    });

    // Extract code from Location header
    const locationHeader = authResponse.headers.get('location');
    if (!locationHeader) {
      throw new Error('No redirect location in authorize response');
    }
    const code = new URL(locationHeader).searchParams.get('code');
    if (!code) {
      throw new Error('No authorization code in redirect URL');
    }

    const tokenResponse = await fetch(`${authServerUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: 'http://localhost:9999/callback',
      }),
    });
    const tokenData = await tokenResponse.json() as Record<string, any>;
    accessToken = tokenData.access_token;
  });

  afterAll(async () => {
    if (authServerProcess) {
      authServerProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        authServerProcess.on('exit', () => resolve());
        setTimeout(() => { authServerProcess.kill('SIGKILL'); resolve(); }, 2000);
      });
    }
  });

  it('should reject MCP requests without token', async () => {
    const response = await fetch(`${authServerUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    expect(response.status).toBe(401);
    const data = await response.json() as Record<string, any>;
    expect(data.error).toBeDefined();
    expect(data.error.message).toContain('Authentication required');
  });

  it('should reject MCP requests with invalid token', async () => {
    const response = await fetch(`${authServerUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer invalid-token-12345',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    expect(response.status).toBe(401);
    const data = await response.json() as Record<string, any>;
    expect(data.error.message).toContain('Authentication required');
  });

  it('should allow MCP requests with valid token', async () => {
    const response = await fetch(`${authServerUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    expect(response.status).not.toBe(401);
    expect(response.status).toBeLessThan(500);
  });
});
