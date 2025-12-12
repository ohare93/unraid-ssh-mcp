# MCP SSH Unraid

A Model Context Protocol (MCP) server that provides secure, read-only SSH access to Unraid servers for debugging and monitoring through AI assistants like Claude.

## Why Use This?

Managing an Unraid server often involves SSH-ing in, running multiple commands, correlating logs, and interpreting system metrics. This MCP server enables AI assistants to do that work for you using natural language.

**Ask questions like:**

- "Why is my Plex container crashing?"
- "Is my array healthy and are there any drives showing signs of failure?"
- "Which containers are consuming the most resources and why?"
- "Help me debug network connectivity between my nginx and database containers"

Instead of manually running `docker logs`, `smartctl`, `docker inspect`, parsing outputs, and correlating information across multiple tools, your AI assistant does it all in seconds.

## Why SSH Instead of the Unraid API?

Unraid 7.2+ includes a [GraphQL API](https://docs.unraid.net/API/), so you might wonder why this project uses SSH instead. The short answer: **the API has significant gaps** for the kind of deep monitoring and debugging this project provides.

### What the Unraid API Cannot Do

The Unraid GraphQL API is still evolving and has documented limitations:

| Feature                                      | API | SSH |
| -------------------------------------------- | --- | --- |
| Docker container logs                        | ❌  | ✅  |
| SMART disk health data                       | ❌  | ✅  |
| Real-time CPU usage/load averages            | ❌  | ✅  |
| Network bandwidth monitoring                 | ❌  | ✅  |
| Disk spin status                             | ❌  | ✅  |
| Process monitoring (ps/top)                  | ❌  | ✅  |
| Log file analysis                            | ❌  | ✅  |
| VM management (libvirt/virsh)                | ❌  | ✅  |
| GPU monitoring                               | ❌  | ✅  |
| UPS status                                   | ❌  | ✅  |
| User scripts                                 | ❌  | ✅  |
| Security auditing (open ports, SSH sessions) | ❌  | ✅  |

Additionally, the API has a [known 32-bit integer overflow](https://github.com/domalab/ha-unraid-connect/issues/8) affecting memory monitoring on systems with >4GB RAM.

### What SSH Enables

With SSH, this project provides **82 specialized tools** that can:

- **Analyze Docker logs** - Search, filter, and correlate logs across all containers simultaneously
- **Parse SMART data** - Detailed drive health analysis including temperature trends, error counts, and failure predictions
- **Monitor everything** - CPU, memory, I/O, network connections, and processes in real-time
- **Search logs everywhere** - Pattern matching across syslog, Docker logs, and application logs
- **Debug inter-container networking** - Test connectivity, DNS resolution, and trace routes between containers
- **Manage VMs** - Full libvirt/virsh access for VM inspection, VNC details, and QEMU logs
- **Audit security** - Check open ports, failed logins, certificate expiration, and container privileges

### Compatibility

| Approach    | Unraid Version                | Rate Limits |
| ----------- | ----------------------------- | ----------- |
| GraphQL API | 7.2+ only (or Connect plugin) | Yes         |
| SSH         | All versions                  | No          |

### The Bottom Line

The Unraid API is great for basic status checks and container start/stop operations. But for the deep debugging, log analysis, and comprehensive monitoring that AI assistants need to actually diagnose problems, SSH provides unrestricted access to all system tools—on any Unraid version, without rate limiting.

## Features

- **82 specialized tools** for comprehensive Unraid server management through natural language
- **Dual transport modes** - Run via stdio (local) or HTTP/SSE (network-accessible)
- **Read-only by design** - Zero risk of accidental system modifications
- **Docker container management** - Inspect, logs, stats, environment variables, port mappings, network topology, and inter-container communication testing
- **Storage & array management** - Parity checks, SMART data analysis, drive temperatures, array sync status, mover logs, cache usage, and share configuration
- **Health diagnostics** - Comprehensive monitoring that aggregates array status, temperatures, disk space, container health, and system resources with automatic issue detection
- **System monitoring** - Process monitoring, resource usage analysis, disk I/O statistics, network connections, and memory pressure detection
- **Log analysis** - Search and analyze logs across all containers and system logs simultaneously with pattern detection
- **VM management** - List, inspect, and monitor virtual machines with VNC connection details and libvirt/QEMU logs
- **Security auditing** - Port scanning, failed login monitoring, permission audits, and vulnerability scanning
- **Filesystem operations** - Browse files, search patterns, check permissions, and monitor disk usage with read-only safety
- **AI-powered insights** - Let Claude correlate data across multiple tools and provide actionable recommendations
- **Faster troubleshooting** - Diagnose complex issues in seconds instead of manually running multiple commands

## Quick Start

### Prerequisites

- Node.js 18 or higher
- Unraid server with SSH access enabled
- SSH key pair for passwordless authentication

### Installation

```bash
git clone <repository-url>
cd mcp-ssh-unraid
npm install
npm run build
```

### Configuration

Create a `.env` file with your Unraid server details:

```bash
cp .env.example .env
# Edit .env with your settings
```

Required environment variables:

```bash
SSH_HOST=unraid.local          # Your Unraid server hostname or IP
SSH_PORT=22                     # SSH port (default: 22)
SSH_USERNAME=mcp-readonly       # Username for SSH connection
SSH_KEY_PATH=~/.ssh/id_rsa_mcp  # Path to SSH private key
```

### MCP Client Setup

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "unraid-ssh": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ssh-unraid/dist/index.js"]
    }
  }
}
```

**Configuration Examples:**

- `mcp-config.json.example` - HTTP/SSE transport (recommended for remote access)
- `mcp-config.stdio.example` - stdio transport for local development

For HTTP mode configuration, see the [HTTP/SSE Mode](#httpsse-mode-network-accessible) section below.

## 🔒 Securing Your Deployment

### Authentication (Required by Default)

OAuth authentication is **REQUIRED by default** in v1.1.0+.

Configure via `REQUIRE_AUTH` environment variable:

| Value            | Use Case                                   |
| ---------------- | ------------------------------------------ |
| `true` (default) | ✅ Production - require OAuth token        |
| `false`          | ⚠️ Local dev only - allows unauthenticated |
| `development`    | ⚠️ Local dev - logs warnings               |

**Never set `REQUIRE_AUTH=false` in production!**

### OAuth Setup

1. Register client:

   ```bash
   curl -X POST http://localhost:3000/register \
     -H "Content-Type: application/json" \
     -d '{"client_name": "My Client"}'
   ```

2. Get authorization code:

   ```bash
   # Visit in browser:
   http://localhost:3000/authorize?client_id=YOUR_ID&redirect_uri=YOUR_REDIRECT&state=xyz&response_type=code
   ```

3. Exchange for token:

   ```bash
   curl -X POST http://localhost:3000/token \
     -d grant_type=authorization_code \
     -d code=YOUR_CODE \
     -d client_id=YOUR_ID \
     -d client_secret=YOUR_SECRET
   ```

4. Use token:
   ```bash
   curl -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

### Network Security

🚫 **DON'T:** Expose directly to internet
✅ **DO:** Use VPN/Tailscale or reverse proxy with TLS

### Security Checklist

- [ ] `REQUIRE_AUTH=true` in production
- [ ] Server behind firewall/VPN or reverse proxy
- [ ] OAuth credentials stored securely
- [ ] Logs monitored for unauthorized attempts

## Security Setup

For secure access, create a dedicated read-only user on your Unraid server:

```bash
# On Unraid server as root
useradd -m -s /bin/bash mcp-readonly
passwd mcp-readonly
usermod -aG docker mcp-readonly

# Make persistent across reboots
echo "useradd -m -s /bin/bash mcp-readonly 2>/dev/null" >> /boot/config/go
echo "usermod -aG docker mcp-readonly 2>/dev/null" >> /boot/config/go
```

Generate and deploy SSH key:

```bash
# On your local machine
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_mcp -C "mcp-ssh-unraid"
ssh-copy-id -i ~/.ssh/id_ed25519_mcp.pub mcp-readonly@unraid.local
```

## Example Usage

Once configured, you can use natural language prompts with your MCP client:

- "List all Docker containers on my Unraid server"
- "Show me the logs for the Plex container"
- "What's the current system load and memory usage?"
- "Run a comprehensive health check"
- "Check the array status and drive temperatures"
- "Which containers are using the most resources?"

## Development

```bash
# Run in development mode with auto-reload
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

## Docker Deployment

**Choose your deployment mode:**

- **Stdio Mode**: Best for local development or when connecting directly from Claude Desktop on the same machine
- **HTTP Mode**: Ideal for running on your Unraid server itself or when accessing from remote clients

### Stdio Mode (Default)

For use with local MCP clients (like Claude Desktop):

```bash
# Build and run with Docker
docker build -t mcp-ssh-unraid .
docker run -d --env-file .env mcp-ssh-unraid

# Or use Docker Compose
docker-compose up -d
```

### HTTP/SSE Mode (Network-Accessible)

For remote access or running as a service on your Unraid server:

```bash
# Build and run with Docker
docker build -f Dockerfile.http -t mcp-ssh-unraid-http .
docker run -d -p 3000:3000 --env-file .env mcp-ssh-unraid-http

# Or use Docker Compose (recommended)
docker-compose -f docker-compose.http.yml up -d
```

#### Environment Variables for HTTP Mode

In addition to the SSH configuration variables, HTTP mode supports:

```bash
HTTP_PORT=3000                            # Port for HTTP server (default: 3000)
CORS_ORIGIN=*                             # CORS origin (default: *, allows all origins)
OAUTH_SERVER_URL=https://mcp.example.com  # Public URL for OAuth discovery (REQUIRED for production)
MOCK_TOKEN=mcp-unraid-access-token        # Mock token for testing (optional)
```

> **Important:** When deploying behind a reverse proxy (Traefik, nginx, etc.), you **must** set `OAUTH_SERVER_URL` to your public URL (e.g., `https://mcp.example.com`). This URL is returned in OAuth discovery metadata endpoints. If not set correctly, OAuth clients will fail with a "protected resource does not match" error.

#### Accessing the HTTP Server

Once running, the server provides:

- **Health endpoint**: `http://localhost:3000/health`
- **MCP endpoint**: `http://localhost:3000/mcp`

#### MCP Client Configuration for HTTP

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "unraid-ssh-http": {
      "url": "http://your-server:3000/mcp",
      "transport": "http"
    }
  }
}
```

Or for Claude Desktop with HTTP support:

```json
{
  "mcpServers": {
    "unraid-ssh-http": {
      "url": "http://your-unraid-server.local:3000/mcp"
    }
  }
}
```

## Contributing

Contributions are welcome! Please ensure:

- All changes maintain read-only security posture
- Tests pass (`npm test`)
- Code follows existing style
- Security considerations are documented

## License

ISC

## Support

For issues and questions, please open an issue on the repository.
