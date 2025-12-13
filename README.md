# MCP SSH SRE

A Model Context Protocol (MCP) server that provides secure, read-only SSH access to Linux servers for debugging and monitoring through AI assistants like Claude. Supports multiple platforms with auto-detection.

## Supported Platforms

| Platform | Status | Tools |
|----------|--------|-------|
| **Unraid** | Full support | 12 modules (10 core + 2 Unraid-specific) |
| **Generic Linux** | Full support | 10 core modules |
| **TrueNAS** | Planned | - |
| **Proxmox** | Planned | - |

The server automatically detects your platform at startup and loads the appropriate tools.

## Why Use This?

Managing a Linux server often involves SSH-ing in, running multiple commands, correlating logs, and interpreting system metrics. This MCP server enables AI assistants to do that work for you using natural language.

**Ask questions like:**

- "Why is my Plex container crashing?"
- "Is my array healthy and are there any drives showing signs of failure?"
- "Which containers are consuming the most resources and why?"
- "Help me debug network connectivity between my nginx and database containers"

Instead of manually running `docker logs`, `smartctl`, `docker inspect`, parsing outputs, and correlating information across multiple tools, your AI assistant does it all in seconds.

## Why SSH Instead of Platform APIs?

Many platforms have APIs (like Unraid's GraphQL API), but they often have significant gaps for deep monitoring and debugging:

| Feature                                      | APIs | SSH |
| -------------------------------------------- | ---- | --- |
| Docker container logs                        | ❌   | ✅  |
| SMART disk health data                       | ❌   | ✅  |
| Real-time CPU usage/load averages            | ❌   | ✅  |
| Network bandwidth monitoring                 | ❌   | ✅  |
| Process monitoring (ps/top)                  | ❌   | ✅  |
| Log file analysis                            | ❌   | ✅  |
| VM management (libvirt/virsh)                | ❌   | ✅  |
| Security auditing (open ports, SSH sessions) | ❌   | ✅  |

SSH provides unrestricted access to all system tools on any Linux system, without rate limiting.

## Features

- **Auto-detection** - Automatically detects your platform (Unraid, generic Linux) and loads appropriate tools
- **12 tool modules with 79+ actions** for comprehensive server management through natural language
- **Dual transport modes** - Run via stdio (local) or HTTP/SSE (network-accessible)
- **Read-only by design** - Zero risk of accidental system modifications
- **Docker container management** - Inspect, logs, stats, environment variables, port mappings, network topology, and inter-container communication testing
- **Storage & array management** - Parity checks, SMART data analysis, drive temperatures, array sync status, mover logs, cache usage, and share configuration (Unraid)
- **Health diagnostics** - Comprehensive monitoring that aggregates system status, temperatures, disk space, container health, and system resources with automatic issue detection
- **System monitoring** - Process monitoring, resource usage analysis, disk I/O statistics, network connections, and memory pressure detection
- **Log analysis** - Search and analyze logs across all containers and system logs simultaneously with pattern detection
- **VM management** - List, inspect, and monitor virtual machines with VNC connection details and libvirt/QEMU logs
- **Security auditing** - Port scanning, failed login monitoring, permission audits, and vulnerability scanning
- **Filesystem operations** - Browse files, search patterns, check permissions, and monitor disk usage with read-only safety

## Quick Start

### Prerequisites

- Node.js 18 or higher
- Linux server with SSH access enabled
- SSH key pair for passwordless authentication

### Installation

```bash
git clone https://github.com/ohare93/mcp-ssh-sre.git
cd mcp-ssh-sre
npm install
npm run build
```

### Configuration

Create a `.env` file with your server details:

```bash
cp .env.example .env
# Edit .env with your settings
```

Required environment variables:

```bash
SSH_HOST=server.local           # Your server hostname or IP
SSH_PORT=22                     # SSH port (default: 22)
SSH_USERNAME=mcp-readonly       # Username for SSH connection
SSH_KEY_PATH=~/.ssh/id_rsa_mcp  # Path to SSH private key
```

### MCP Client Setup

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "ssh-sre": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-ssh-sre/dist/index.js"]
    }
  }
}
```

**Configuration Examples:**

- `mcp-config.json.example` - HTTP/SSE transport (recommended for remote access)
- `mcp-config.stdio.example` - stdio transport for local development

For HTTP mode configuration, see the [HTTP/SSE Mode](#httpsse-mode-network-accessible) section below.

## Securing Your Deployment

### Authentication (Required by Default)

OAuth authentication is **REQUIRED by default** in v2.0.0+.

Configure via `REQUIRE_AUTH` environment variable:

| Value            | Use Case                                   |
| ---------------- | ------------------------------------------ |
| `true` (default) | Production - require OAuth token           |
| `false`          | Local dev only - allows unauthenticated    |
| `development`    | Local dev - logs warnings                  |

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

- **DON'T:** Expose directly to internet
- **DO:** Use VPN/Tailscale or reverse proxy with TLS

### Security Checklist

- [ ] `REQUIRE_AUTH=true` in production
- [ ] Server behind firewall/VPN or reverse proxy
- [ ] OAuth credentials stored securely
- [ ] Logs monitored for unauthorized attempts

## Security Setup

For secure access, create a dedicated read-only user on your server:

```bash
# On server as root
useradd -m -s /bin/bash mcp-readonly
passwd mcp-readonly
usermod -aG docker mcp-readonly
```

Generate and deploy SSH key:

```bash
# On your local machine
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_mcp -C "mcp-ssh-sre"
ssh-copy-id -i ~/.ssh/id_ed25519_mcp.pub mcp-readonly@server.local
```

## Example Usage

Once configured, you can use natural language prompts with your MCP client:

- "List all Docker containers on my server"
- "Show me the logs for the Plex container"
- "What's the current system load and memory usage?"
- "Run a comprehensive health check"
- "Check the array status and drive temperatures" (Unraid)
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
- **HTTP Mode**: Ideal for running on your server itself or when accessing from remote clients

### Stdio Mode (Default)

For use with local MCP clients (like Claude Desktop):

```bash
# Build and run with Docker
docker build -t mcp-ssh-sre .
docker run -d --env-file .env mcp-ssh-sre

# Or use Docker Compose
docker-compose up -d
```

### HTTP/SSE Mode (Network-Accessible)

For remote access or running as a service on your server:

```bash
# Build and run with Docker
docker build -f Dockerfile.http -t mcp-ssh-sre .
docker run -d -p 3000:3000 --env-file .env mcp-ssh-sre

# Or use Docker Compose (recommended)
docker-compose -f docker-compose.http.yml up -d
```

#### Environment Variables for HTTP Mode

In addition to the SSH configuration variables, HTTP mode supports:

```bash
HTTP_PORT=3000                            # Port for HTTP server (default: 3000)
CORS_ORIGIN=*                             # CORS origin (default: *, allows all origins)
OAUTH_SERVER_URL=https://mcp.example.com  # Public URL for OAuth discovery (REQUIRED for production)
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
    "ssh-sre": {
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
    "ssh-sre": {
      "url": "http://your-server.local:3000/mcp"
    }
  }
}
```

## Architecture

The server uses a platform abstraction layer:

```
src/
├── platforms/
│   ├── types.ts          # Platform interfaces
│   ├── registry.ts       # Platform detection & registration
│   ├── linux/            # Generic Linux (baseline)
│   └── unraid/           # Unraid-specific tools
├── tools/
│   └── core/             # 10 core tool modules (all platforms)
├── tool-loader.ts        # Dynamic tool loading
├── index.ts              # Stdio transport entry
└── http-server.ts        # HTTP transport entry
```

### Adding New Platforms

1. Create `src/platforms/<platform>/index.ts` implementing the `Platform` interface
2. Add detection logic (file checks, command output parsing)
3. Create platform-specific tool modules
4. Register in `src/platforms/index.ts`

## Contributing

Contributions are welcome! Please ensure:

- All changes maintain read-only security posture
- Tests pass (`npm test`)
- Code follows existing style
- Security considerations are documented

## License

ISC

## Support

For issues and questions, please open an issue on the [GitHub repository](https://github.com/ohare93/mcp-ssh-sre).
