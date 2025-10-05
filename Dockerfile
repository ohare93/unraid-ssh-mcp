# Multi-stage build for optimal image size
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S mcp && \
    adduser -u 1001 -S mcp -G mcp

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create directory for SSH keys
RUN mkdir -p /home/mcp/.ssh && \
    chown -R mcp:mcp /home/mcp/.ssh && \
    chmod 700 /home/mcp/.ssh

# Switch to non-root user
USER mcp

# Set environment for production
ENV NODE_ENV=production

# Health check to verify SSH connectivity
# This will check if the SSH connection can be established
# Runs every 30 seconds, timeout after 10 seconds
# Note: Requires SSH_HOST, SSH_USERNAME, and SSH_PRIVATE_KEY_PATH env vars to be set
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const {NodeSSH}=require('node-ssh');const ssh=new NodeSSH();ssh.connect({host:process.env.SSH_HOST||'localhost',port:parseInt(process.env.SSH_PORT||'22'),username:process.env.SSH_USERNAME,privateKeyPath:process.env.SSH_PRIVATE_KEY_PATH}).then(()=>{ssh.dispose();process.exit(0)}).catch(()=>process.exit(1))" || exit 1

# Run the HTTP/SSE MCP server
CMD ["node", "dist/http-server.js"]
