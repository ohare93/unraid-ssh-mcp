import { NodeSSH } from "node-ssh";
import "dotenv/config";

/**
 * SSH Connection Manager
 * Handles SSH connections to Unraid server with auto-reconnect functionality
 */
export class SSHConnectionManager {
  private ssh: NodeSSH;
  private config: {
    host: string;
    port: number;
    username: string;
    privateKeyPath?: string;
    password?: string;
  };
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private baseBackoffMs: number = 1000;
  private commandTimeoutMs: number;
  private maxConsecutiveFailures: number;
  private consecutiveFailures: number = 0;
  private circuitBreakerOpen: boolean = false;

  constructor() {
    this.ssh = new NodeSSH();

    // Load SSH configuration from environment variables
    const host = process.env.SSH_HOST;
    const port = process.env.SSH_PORT ? parseInt(process.env.SSH_PORT) : 22;
    const username = process.env.SSH_USERNAME;
    const privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH;
    const password = process.env.SSH_PASSWORD;

    if (!host) {
      throw new Error("SSH_HOST environment variable is required");
    }
    if (!username) {
      throw new Error("SSH_USERNAME environment variable is required");
    }
    if (!privateKeyPath && !password) {
      throw new Error("Either SSH_PRIVATE_KEY_PATH or SSH_PASSWORD environment variable is required");
    }

    this.config = {
      host,
      port,
      username,
      privateKeyPath,
      password,
    };

    // Load timeout and circuit breaker configuration
    this.commandTimeoutMs = process.env.COMMAND_TIMEOUT_MS
      ? parseInt(process.env.COMMAND_TIMEOUT_MS)
      : 15000; // Default: 15 seconds
    this.maxConsecutiveFailures = process.env.MAX_CONSECUTIVE_FAILURES
      ? parseInt(process.env.MAX_CONSECUTIVE_FAILURES)
      : 3; // Default: 3 consecutive failures
  }

  /**
   * Establish SSH connection
   */
  async connect(): Promise<void> {
    try {
      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
      };

      if (this.config.privateKeyPath) {
        connectionConfig.privateKeyPath = this.config.privateKeyPath;
      } else if (this.config.password) {
        connectionConfig.password = this.config.password;
      }

      await this.ssh.connect(connectionConfig);
      this.connected = true;
      this.reconnectAttempts = 0;
      console.error(`Successfully connected to ${this.config.host}`);
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to SSH server: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reconnect with exponential backoff
   */
  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Failed to reconnect after ${this.maxReconnectAttempts} attempts`);
    }

    this.reconnectAttempts++;
    const backoffMs = this.baseBackoffMs * Math.pow(2, this.reconnectAttempts - 1);

    console.error(`Attempting to reconnect (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${backoffMs}ms...`);

    await new Promise(resolve => setTimeout(resolve, backoffMs));
    await this.connect();
  }

  /**
   * Execute command via SSH with timeout and circuit breaker protection
   */
  async executeCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      throw new Error(
        `Circuit breaker is open after ${this.consecutiveFailures} consecutive failures. ` +
        `Please check server health or restart the MCP server to reset.`
      );
    }

    // Timeout ID for cleanup
    let timeoutId: NodeJS.Timeout | null = null;

    try {
      if (!this.connected) {
        await this.connect();
      }

      // Create a timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`TIMEOUT: Command timed out after ${this.commandTimeoutMs}ms`));
        }, this.commandTimeoutMs);
      });

      // Race between command execution and timeout
      const result = await Promise.race([
        this.ssh.execCommand(command),
        timeoutPromise,
      ]);

      // Clear timeout on success
      if (timeoutId) clearTimeout(timeoutId);

      // Reset circuit breaker on successful command
      this.consecutiveFailures = 0;
      this.circuitBreakerOpen = false;

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code ?? 0,
      };
    } catch (error) {
      // Clear timeout on error
      if (timeoutId) clearTimeout(timeoutId);

      // Increment failure counter
      this.consecutiveFailures++;

      // Open circuit breaker if threshold reached
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.circuitBreakerOpen = true;
        console.error(
          `Circuit breaker opened after ${this.consecutiveFailures} consecutive failures. ` +
          `Future commands will fail immediately until the MCP server is restarted.`
        );
      }

      // Determine error type for better error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.includes("TIMEOUT:");
      const isConnection = errorMessage.toLowerCase().includes("connection");

      if (isTimeout) {
        throw new Error(
          `Command timed out after ${this.commandTimeoutMs}ms. ` +
          `The command may be hung or taking too long. ` +
          `Consider increasing COMMAND_TIMEOUT_MS if this is a long-running operation.`
        );
      }

      if (isConnection) {
        this.connected = false;
        throw new Error(
          `SSH connection lost: ${errorMessage}. ` +
          `The MCP server will attempt to reconnect on the next command. ` +
          `If this persists, check your network connection and SSH credentials.`
        );
      }

      throw new Error(`Failed to execute command: ${errorMessage}`);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from SSH
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      this.ssh.dispose();
      this.connected = false;
      console.error("Disconnected from SSH server");
    }
  }
}
