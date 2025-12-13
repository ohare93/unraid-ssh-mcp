import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import "dotenv/config";
import { SSHConnectionManager } from "./ssh-manager.js";
import { initializePlatforms, platformRegistry, Platform } from "./platforms/index.js";
import { loadTools } from "./tool-loader.js";
import { authenticateRequest } from './middleware/auth.js';
import crypto from "crypto";

// ANSI color codes for logging
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// Logging utilities
const log = {
  info: (msg: string, ...args: any[]) => {
    console.error(`${colors.blue}[INFO]${colors.reset} ${msg}`, ...args);
  },
  success: (msg: string, ...args: any[]) => {
    console.error(`${colors.green}[SUCCESS]${colors.reset} ${msg}`, ...args);
  },
  warn: (msg: string, ...args: any[]) => {
    console.error(`${colors.yellow}[WARN]${colors.reset} ${msg}`, ...args);
  },
  error: (msg: string, ...args: any[]) => {
    console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`, ...args);
  },
  oauth: (msg: string, ...args: any[]) => {
    console.error(`${colors.magenta}[OAUTH]${colors.reset} ${msg}`, ...args);
  },
  mcp: (msg: string, ...args: any[]) => {
    console.error(`${colors.cyan}[MCP]${colors.reset} ${msg}`, ...args);
  },
  ssh: (msg: string, ...args: any[]) => {
    console.error(`${colors.bright}${colors.white}[SSH]${colors.reset} ${msg}`, ...args);
  },
};

// Simple in-memory storage for OAuth clients and tokens
const oauthClients = new Map<string, any>();
const oauthTokens = new Map<string, any>();
const authorizationCodes = new Map<string, any>();

// OAuth mock implementation
// OAUTH_SERVER_URL should be set in production - this default is for local testing only
const OAUTH_SERVER_URL = process.env.OAUTH_SERVER_URL || "http://localhost:8080";
const MOCK_TOKEN = process.env.MOCK_TOKEN || "mcp-unraid-access-token";

// Read and validate REQUIRE_AUTH environment variable
const requireAuthValue = process.env.REQUIRE_AUTH || "true";
const validAuthValues = ["true", "false", "development"];

if (!validAuthValues.includes(requireAuthValue)) {
  console.error(`❌ Invalid REQUIRE_AUTH value: "${requireAuthValue}"`);
  console.error(`   Must be one of: ${validAuthValues.join(", ")}`);
  process.exit(1);
}

const REQUIRE_AUTH = requireAuthValue === "true" ? true
                    : requireAuthValue === "false" ? false
                    : "development" as const;

/**
 * HTTP MCP Server with OAuth Support
 * Serves MCP over HTTP using StreamableHTTPServerTransport
 */
async function main() {
  const app = express();
  const port = parseInt(process.env.HTTP_PORT || "3000");

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    log.info(`${req.method} ${req.path} - ${req.ip}`);

    if (req.body && Object.keys(req.body).length > 0) {
      log.info(`Request body: ${JSON.stringify(req.body).substring(0, 200)}`);
    }

    // Log response
    const originalSend = res.send;
    res.send = function (data: any) {
      log.info(`${req.method} ${req.path} - ${res.statusCode}`);
      return originalSend.call(this, data);
    };

    next();
  });

  // Middleware
  app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Initialize SSH connection manager
  const sshManager = new SSHConnectionManager();

  try {
    // Establish initial connection
    log.ssh("Connecting to SSH server...");
    await sshManager.connect();
    log.success("SSH connection established");
  } catch (error) {
    log.warn(`Could not establish initial SSH connection: ${error instanceof Error ? error.message : String(error)}`);
    log.warn("Server will attempt to connect when first command is executed");
  }

  // Initialize platform registry
  log.info("Initializing platform registry...");
  initializePlatforms();

  // Create SSH executor adapter for tool modules
  const sshExecutor = async (command: string): Promise<string> => {
    const result = await sshManager.executeCommand(command);
    if (result.exitCode !== 0 && result.stderr) {
      const cmdPreview = command.length > 100 ? command.substring(0, 100) + "..." : command;
      throw new Error(`Command failed (exit ${result.exitCode}): ${cmdPreview}\n${result.stderr}`);
    }
    return result.stdout;
  };

  // Detect platform
  log.info("Detecting platform...");
  let detectedPlatform: Platform;
  try {
    detectedPlatform = await platformRegistry.detect(sshExecutor);
    log.success(`Detected platform: ${detectedPlatform.displayName} (${detectedPlatform.id})`);
  } catch (error) {
    log.error(`Platform detection failed: ${error instanceof Error ? error.message : String(error)}`);
    log.warn("Falling back to generic Linux platform");
    const fallback = platformRegistry.get("linux");
    if (!fallback) {
      throw new Error("Platform detection failed and no fallback platform available");
    }
    detectedPlatform = fallback;
  }

  // Create MCP server (shared across all requests)
  log.info("Initializing MCP server...");
  const server = new McpServer({
    name: "mcp-ssh-sre",
    version: "2.0.0",
  });

  // Load tools for detected platform
  log.info("Loading tools for platform...");
  loadTools(server, sshExecutor, detectedPlatform);
  log.success("All MCP tools registered");

  // ==========================================================================
  // OAuth 2.1 Mock Endpoints
  // ==========================================================================

  // OAuth Authorization Server Metadata (RFC 8414)
  app.get("/.well-known/oauth-authorization-server/mcp", (req: Request, res: Response) => {
    log.oauth("OAuth discovery metadata requested");
    res.json({
      issuer: `${OAUTH_SERVER_URL}/mcp`,
      authorization_endpoint: `${OAUTH_SERVER_URL}/authorize`,
      token_endpoint: `${OAUTH_SERVER_URL}/token`,
      registration_endpoint: `${OAUTH_SERVER_URL}/register`,
      scopes_supported: ["mcp:read", "mcp:write", "mcp:admin"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    });
  });

  // OAuth Protected Resource Metadata
  app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
    log.oauth("OAuth protected resource metadata requested");
    res.json({
      resource: `${OAUTH_SERVER_URL}/mcp`,
      authorization_servers: [`${OAUTH_SERVER_URL}/mcp`],
      scopes_supported: ["mcp:read", "mcp:write", "mcp:admin"],
    });
  });

  // Dynamic Client Registration (RFC 7591)
  app.post("/register", (req: Request, res: Response) => {
    const clientId = crypto.randomBytes(16).toString("hex");
    const clientSecret = crypto.randomBytes(32).toString("hex");

    log.oauth(`Client registration requested`);
    log.oauth(`Registering new client: ${clientId}`);

    const client = {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: req.body.redirect_uris || [],
      grant_types: req.body.grant_types || ["authorization_code", "refresh_token"],
      response_types: req.body.response_types || ["code"],
      client_name: req.body.client_name || "MCP Client",
      token_endpoint_auth_method: req.body.token_endpoint_auth_method || "client_secret_post",
    };

    oauthClients.set(clientId, client);
    log.success(`Client registered: ${clientId}`);

    res.status(201).json(client);
  });

  // Authorization Endpoint
  app.get("/authorize", (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;

    log.oauth(`Authorization requested for client: ${client_id}`);
    log.oauth(`Redirect URI: ${redirect_uri}, State: ${state}`);

    // Generate authorization code
    const authCode = crypto.randomBytes(32).toString("hex");
    authorizationCodes.set(authCode, {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      expires_at: Date.now() + 600000, // 10 minutes
    });

    log.success(`Authorization code generated: ${authCode.substring(0, 16)}...`);

    // Redirect back with code
    const redirectUrl = `${redirect_uri}?code=${authCode}&state=${state}`;
    res.redirect(redirectUrl);
  });

  // Token Endpoint
  app.post("/token", (req: Request, res: Response) => {
    const { grant_type, code, refresh_token, client_id, client_secret, code_verifier } = req.body;

    log.oauth(`Token request: grant_type=${grant_type}, client=${client_id}`);

    if (grant_type === "authorization_code") {
      const authCodeData = authorizationCodes.get(code);

      if (!authCodeData) {
        log.error("Invalid authorization code");
        return res.status(400).json({ error: "invalid_grant" });
      }

      if (authCodeData.expires_at < Date.now()) {
        log.error("Authorization code expired");
        authorizationCodes.delete(code);
        return res.status(400).json({ error: "invalid_grant" });
      }

      // Generate tokens
      const accessToken = crypto.randomBytes(32).toString("hex");
      const refreshToken = crypto.randomBytes(32).toString("hex");

      oauthTokens.set(accessToken, {
        client_id,
        scope: "mcp:read mcp:write mcp:admin",
        expires_at: Date.now() + 3600000, // 1 hour
      });

      authorizationCodes.delete(code);
      log.success(`Access token issued: ${accessToken.substring(0, 16)}...`);

      return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: "mcp:read mcp:write mcp:admin",
      });
    }

    if (grant_type === "refresh_token") {
      log.oauth("Refreshing token");
      const newAccessToken = crypto.randomBytes(32).toString("hex");
      const newRefreshToken = crypto.randomBytes(32).toString("hex");

      oauthTokens.set(newAccessToken, {
        client_id,
        scope: "mcp:read mcp:write mcp:admin",
        expires_at: Date.now() + 3600000,
      });

      log.success(`New access token issued: ${newAccessToken.substring(0, 16)}...`);

      return res.json({
        access_token: newAccessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: newRefreshToken,
        scope: "mcp:read mcp:write mcp:admin",
      });
    }

    log.error(`Unsupported grant type: ${grant_type}`);
    res.status(400).json({ error: "unsupported_grant_type" });
  });

  // ==========================================================================
  // Health and MCP Endpoints
  // ==========================================================================

  // Health check endpoint
  app.get("/health", async (req: Request, res: Response) => {
    const isSSHConnected = sshManager.isConnected();
    const status = isSSHConnected ? "healthy" : "degraded";
    const httpCode = isSSHConnected ? 200 : 503;

    res.status(httpCode).json({
      status,
      ssh_connected: isSSHConnected,
      server: "mcp-ssh-sre",
      version: "2.0.0",
      transport: "http",
      oauth: "enabled",
      platform: {
        id: detectedPlatform.id,
        name: detectedPlatform.displayName,
      },
    });
  });

  // MCP endpoint with OAuth authentication enforcement
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      // Authenticate the request
      const authResult = authenticateRequest(req, oauthTokens, REQUIRE_AUTH);

      // Enforce authentication if required
      if (REQUIRE_AUTH === true && !authResult.authenticated) {
        log.warn(`🔒 Unauthorized MCP request blocked: ${authResult.error}`);
        return res.status(401).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Authentication required",
            data: authResult.error
          },
          id: req.body?.id || null
        });
      }

      // Log authentication status
      if (authResult.authenticated) {
        log.mcp(`✅ Authenticated MCP request from client: ${authResult.clientId}`);
      } else if (REQUIRE_AUTH === "development") {
        log.warn(`⚠️  DEVELOPMENT MODE: Allowing unauthenticated MCP request`);
      } else {
        log.mcp(`ℹ️  Unauthenticated MCP request (REQUIRE_AUTH=false)`);
      }

      // Log MCP method if available
      if (req.body && req.body.method) {
        log.mcp(`Method: ${req.body.method}`);
      }

      // Create a new transport for each request to prevent ID collisions
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
        enableJsonResponse: true,
      });

      // Connect the server to the transport
      await server.connect(transport);

      // Handle the MCP request
      await transport.handleRequest(req, res, req.body);

      log.success("MCP request handled successfully");
    } catch (error) {
      log.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    log.warn("\nShutting down gracefully...");
    await sshManager.disconnect();
    log.info("SSH connection closed");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the server
  app.listen(port, () => {
    log.success(`MCP SSH SRE Server (HTTP + OAuth) listening on port ${port}`);
    log.info(`Platform: ${detectedPlatform.displayName} (${detectedPlatform.id})`);
    log.info(`Health endpoint: http://localhost:${port}/health`);
    log.info(`MCP endpoint: http://localhost:${port}/mcp`);
    log.info(`OAuth discovery: http://localhost:${port}/.well-known/oauth-authorization-server/mcp`);
    log.success("Server ready!");

    // Security mode logging
    console.log("\n" + "=".repeat(80));
    if (REQUIRE_AUTH === true) {
      log.success("🔒 SECURITY: OAuth authentication is REQUIRED");
      log.info("   All MCP requests must include a valid Bearer token");
      log.info("   Register clients: POST http://localhost:" + port + "/register");
    } else if (REQUIRE_AUTH === false) {
      log.warn("🚨 WARNING: OAuth authentication is DISABLED");
      log.warn("   Anyone can access the MCP endpoint without authentication!");
      log.warn("   This mode should ONLY be used for local development");
      log.warn("   NEVER expose this server to the internet with REQUIRE_AUTH=false");
    } else {
      log.warn("⚠️  DEVELOPMENT MODE: Authentication warnings enabled");
      log.warn("   Unauthenticated requests will be logged but allowed");
    }
    console.log("=".repeat(80) + "\n");
  });
}

// Start the server
main().catch((error) => {
  log.error("Fatal error:", error);
  process.exit(1);
});
