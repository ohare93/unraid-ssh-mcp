# MCP SSH Unraid - Project Instructions

## Version Bumping Workflow

After bumping the version in this project, you MUST update the deployment configuration:

1. **Update version in these files:**
   - `package.json` - version field
   - `src/http-server.ts` - McpServer version (line ~123)
   - `src/http-server.ts` - health endpoint version (line ~313)
   - `src/__tests__/http-server.test.ts` - expected version in test

2. **Build and test:**
   - Run `npm run build && npm test`
   - Build Docker image with new version tag
   - Push to registry: `git.munchohare.com/jmo/mcp-ssh-unraid:{version}`

3. **CRITICAL: Update deployment config:**
   - File: `/home/jmo/Development/DockerUnraid/mcp-ssh-unraid/compose.yaml`
   - Update the `image:` tag to match the new version
   - This is REQUIRED - do not skip this step

## Testing MCP Functionality

When testing the deployed MCP server, use the MCP tools (e.g., `mcp__unraid-ssh__*`) to verify functionality. Test various filter combinations to ensure the filtering system works correctly.

## Filter System

All 85 tools support comprehensive output filtering. Filters are defined in `src/filters.ts` and applied via `...outputFiltersSchema.shape` pattern. When adding new tools, always include filter support.
