# MCP SSH Unraid - Project Instructions

## User Expectations

### Accuracy and Verification
- **Always count before claiming**: Never state tool counts or numbers without actually counting them first (e.g., use `grep -c` to count server.tool() calls)
- **Be precise and consistent**: If documentation says "85 tools" and README says "86 tools", count the actual number and fix all inconsistencies
- **Verify arithmetic**: When removing N tools from X total, actually verify the result instead of guessing

### Docker Registry Push
- **Retry on failure**: If `docker push` fails due to network timeout, retry when requested - the issue may be temporary
- **Don't give up early**: Network issues can be transient, so attempt retries as requested

### Removing Features
When removing tools or features:
1. Count the actual number of tools being removed
2. Count the current total across all files
3. Calculate the new total: current - removed = new
4. Update ALL documentation consistently:
   - `.claude/CLAUDE.md` - tool count
   - `README.md` - tool count
   - Test files - expected counts
   - Tool registration tests

## Version Bumping Workflow

After bumping the version in this project, you MUST update the deployment configuration:

1. **Update version in these files:**
   - `package.json` - version field
   - `src/http-server.ts` - McpServer version (line ~123)
   - `src/http-server.ts` - health endpoint version (line ~313)
   - `src/__tests__/http-server.test.ts` - expected version in test

2. **Build and test:**
   - Run `npm run build && npm test`
   - Verify all 403 tests pass

3. **Build and publish Docker image:**
   - Build with both version tag and latest:
     ```bash
     docker build -f Dockerfile.http -t your-registry.com/your-org/mcp-ssh-unraid:{version} -t your-registry.com/your-org/mcp-ssh-unraid:latest .
     ```
   - Push both tags to registry:
     ```bash
     docker push your-registry.com/your-org/mcp-ssh-unraid:{version}
     docker push your-registry.com/your-org/mcp-ssh-unraid:latest
     ```
   - If push fails with network timeout, retry as requested

4. **Update deployment configuration:**
   - Update your deployment config file (e.g., compose.yaml or kubernetes manifest)
   - Update the `image:` tag to match the new version

## Testing MCP Functionality

When testing the deployed MCP server, use the MCP tools (e.g., `mcp__unraid-ssh__*`) to verify functionality. Test various filter combinations to ensure the filtering system works correctly.

## Filter System

All 82 tools support comprehensive output filtering. Filters are defined in `src/filters.ts` and applied via `...outputFiltersSchema.shape` pattern. When adding new tools, always include filter support.
