import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';

// Type definitions for JSON responses
interface ClientRegistrationResponse {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface ErrorResponse {
  error?: {
    message: string;
    data?: string;
  };
}

interface MetadataResponse {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
}

/**
 * OAuth Authentication Enforcement Tests
 *
 * Tests the critical security fix for OAuth authentication enforcement.
 * Prior to v1.1.0, OAuth was present but not enforced - this was a critical
 * security vulnerability (CVE pending).
 *
 * These tests verify that:
 * 1. Unauthenticated requests are rejected when REQUIRE_AUTH=true
 * 2. Invalid tokens are rejected
 * 3. Valid tokens are accepted
 * 4. The complete OAuth flow works end-to-end
 */
describe('OAuth Authentication Enforcement', () => {
  let serverProcess: ChildProcess;
  const testPort = 3997;
  const serverUrl = `http://localhost:${testPort}`;

  // OAuth credentials from successful registration
  let clientId: string;
  let clientSecret: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    // Start HTTP server with REQUIRE_AUTH=true (production mode)
    serverProcess = spawn('tsx', ['src/http-server.ts'], {
      env: {
        ...process.env,
        HTTP_PORT: testPort.toString(),
        REQUIRE_AUTH: 'true', // Critical: test with authentication REQUIRED
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

    // Complete OAuth flow to get valid credentials for testing
    await setupOAuthCredentials();
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

  /**
   * Helper: Complete OAuth flow to obtain valid credentials
   */
  async function setupOAuthCredentials() {
    // 1. Register a new OAuth client
    const registerResponse = await fetch(`${serverUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Test Client',
        redirect_uris: ['http://localhost:5000/callback'],
      }),
    });

    expect(registerResponse.status).toBe(201);
    const clientData = await registerResponse.json() as ClientRegistrationResponse;
    clientId = clientData.client_id;
    clientSecret = clientData.client_secret;

    expect(clientId).toBeDefined();
    expect(clientSecret).toBeDefined();

    // 2. Get authorization code (simulating user authorization)
    const authResponse = await fetch(
      `${serverUrl}/authorize?client_id=${clientId}&redirect_uri=http://localhost:5000/callback&state=test-state&response_type=code`,
      { redirect: 'manual' } // Don't follow redirect
    );

    expect(authResponse.status).toBe(302); // Redirect with auth code
    const locationHeader = authResponse.headers.get('location');
    expect(locationHeader).toBeDefined();

    const redirectUrl = new URL(locationHeader!);
    const authCode = redirectUrl.searchParams.get('code');
    expect(authCode).toBeDefined();

    // 3. Exchange authorization code for access token
    const tokenResponse = await fetch(`${serverUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authCode,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenData = await tokenResponse.json() as TokenResponse;
    accessToken = tokenData.access_token;
    refreshToken = tokenData.refresh_token;

    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
  }

  describe('Authentication Rejection (REQUIRE_AUTH=true)', () => {
    it('should reject MCP requests with no Authorization header', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
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

      const data = await response.json() as ErrorResponse;
      expect(data.error).toBeDefined();
      expect(data.error!.message).toBe('Authentication required');
      expect(data.error!.data).toContain('No authorization header');
    });

    it('should reject MCP requests with malformed Authorization header', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'InvalidFormat token123', // Wrong format
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      expect(response.status).toBe(401);

      const data = await response.json() as ErrorResponse;
      expect(data.error!.data).toContain('Invalid authorization header format');
    });

    it('should reject MCP requests with invalid Bearer token', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer invalid-fake-token-12345',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      expect(response.status).toBe(401);

      const data = await response.json() as ErrorResponse;
      expect(data.error).toBeDefined();
      expect(data.error!.message).toBe('Authentication required');
      expect(data.error!.data).toContain('Invalid access token');
    });

    it('should reject MCP requests with empty Bearer token', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      expect(response.status).toBe(401);
      expect(((await response.json()) as ErrorResponse).error).toBeDefined();
    });
  });

  describe('Authentication Acceptance (Valid Tokens)', () => {
    it('should accept MCP requests with valid Bearer token', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
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

      // Should NOT be 401 (unauthorized)
      expect(response.status).not.toBe(401);

      // Should be successful (200), connection issue (503), or transport error (406)
      // but NOT authentication failure
      expect([200, 406, 503]).toContain(response.status);
    });

    it('should accept multiple sequential authenticated requests', async () => {
      // Make 5 requests with same token to verify token reuse works
      for (let i = 1; i <= 5; i++) {
        const response = await fetch(`${serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/list',
            id: i,
          }),
        });

        expect(response.status).not.toBe(401);
      }
    });
  });

  describe('OAuth Flow Integration', () => {
    it('should complete full OAuth authorization code flow', async () => {
      // This test verifies the complete OAuth flow works end-to-end
      // Steps already completed in setupOAuthCredentials():
      // 1. Client registration ✓
      // 2. Authorization code generation ✓
      // 3. Token exchange ✓
      // 4. Token usage ✓ (tested in other tests)

      expect(clientId).toBeDefined();
      expect(clientSecret).toBeDefined();
      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
    });

    it('should reject requests with expired authorization codes', async () => {
      // Use a fake authorization code (never generated)
      const tokenResponse = await fetch(`${serverUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: 'fake-expired-auth-code-12345',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      expect(tokenResponse.status).toBe(400);
      const data = await tokenResponse.json() as { error: string };
      expect(data.error).toBe('invalid_grant');
    });

    it('should support token refresh flow', async () => {
      // Use the refresh token to get a new access token
      const refreshResponse = await fetch(`${serverUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      expect(refreshResponse.status).toBe(200);
      const newTokenData = await refreshResponse.json() as TokenResponse;

      expect(newTokenData.access_token).toBeDefined();
      expect(newTokenData.refresh_token).toBeDefined();
      expect(newTokenData.token_type).toBe('Bearer');
      expect(newTokenData.expires_in).toBe(3600);

      // Verify new token works
      const mcpResponse = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${newTokenData.access_token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      expect(mcpResponse.status).not.toBe(401);
    });
  });

  describe('OAuth Discovery Endpoints', () => {
    it('should provide OAuth authorization server metadata', async () => {
      const response = await fetch(`${serverUrl}/.well-known/oauth-authorization-server/mcp`);

      expect(response.status).toBe(200);
      const metadata = await response.json() as MetadataResponse & { scopes_supported: string[] };

      expect(metadata.issuer).toBeDefined();
      expect(metadata.authorization_endpoint).toBeDefined();
      expect(metadata.token_endpoint).toBeDefined();
      expect(metadata.registration_endpoint).toBeDefined();
      expect(metadata.scopes_supported).toContain('mcp:read');
      expect(metadata.grant_types_supported).toContain('authorization_code');
    });

    it('should provide OAuth protected resource metadata', async () => {
      const response = await fetch(`${serverUrl}/.well-known/oauth-protected-resource`);

      expect(response.status).toBe(200);
      const metadata = await response.json() as { resource: string; authorization_servers: string[]; scopes_supported: string[] };

      expect(metadata.resource).toBeDefined();
      expect(metadata.authorization_servers).toBeDefined();
      expect(metadata.scopes_supported).toContain('mcp:read');
    });

    it('should allow unauthenticated access to discovery endpoints', async () => {
      // Discovery endpoints should be publicly accessible (no auth required)
      const responses = await Promise.all([
        fetch(`${serverUrl}/.well-known/oauth-authorization-server/mcp`),
        fetch(`${serverUrl}/.well-known/oauth-protected-resource`),
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Security Error Messages', () => {
    it('should provide helpful error messages without leaking sensitive info', async () => {
      const response = await fetch(`${serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer invalid-token',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      const data = await response.json() as ErrorResponse;

      // Should have helpful error message
      expect(data.error!.message).toBe('Authentication required');
      expect(data.error!.data).toContain('Invalid access token');

      // Should NOT leak implementation details
      expect(data.error!.data).not.toContain('oauthTokens');
      expect(data.error!.data).not.toContain('Map');
    });
  });
});
