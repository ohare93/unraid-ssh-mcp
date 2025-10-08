# Filter System Update Summary

## Completed Files

### 1. docker-advanced-tools.ts ✓
- **Tools Updated:** 6
- **Changes:**
  - Changed import from `./utils.js` to `./filters.js`
  - Updated all 6 tools:
    1. `docker container env` - Uses `applyFilters` on command
    2. `docker top` - Uses `applyFilters` on command
    3. `docker health check all` - Uses `applyFiltersToText` on formatted output
    4. `docker logs aggregate` - Uses `applyFiltersToText` on result text
    5. `docker compose ps` - Uses `applyFiltersToText` on formatted output (both branches)
    6. `docker compose up` - Uses `applyFilters` on command

### 2. system-tools.ts ✓
- **Tools Updated:** 5 (1 tool removed)
- **Changes:**
  - Changed import from `./utils.js` to `./filters.js`
  - **REMOVED** `system tail log` tool (lines 102-145) - redundant with filter system
  - Updated all 5 remaining tools:
    1. `system list files` - Uses `applyFilters` on command
    2. `system read file` - Uses `applyFilters` on command, updated truncation warning
    3. `system find files` - Uses `applyFilters` on command
    4. `system disk usage` - Uses `applyFilters` on command
    5. `system get system info` - Uses `applyFilters` on command

## Remaining Files to Update

The following files do NOT use the old grep filter system and need to be updated to add comprehensive filter support:

### 3. monitoring-tools.ts (5 tools)
**Current import:** Uses `applyGrepFilter` from `./utils.js`

All tools need filter support added:
1. `monitoring ps list` - Has old grep params, needs conversion
2. `monitoring process tree` - Has old grep params, needs conversion
3. `monitoring top snapshot` - No filters currently, needs `...outputFiltersSchema.shape` and command filtering
4. `monitoring iostat snapshot` - No filters currently, needs support
5. `monitoring network connections` - Has old grep params, needs conversion

### 4. docker-network-tools.ts (5 tools)
**Current import:** No filter import at all

All tools need filter support added:
1. `docker list networks` - Uses `applyFiltersToText` on formatted output
2. `docker inspect network` - Uses `applyFiltersToText` on JSON formatted output
3. `docker list volumes` - Uses `applyFiltersToText` on formatted output
4. `docker inspect volume` - Uses `applyFiltersToText` on JSON formatted output
5. `docker network containers` - Uses `applyFiltersToText` on formatted output

### 5. vm-tools.ts (4 tools)
**Current import:** No filter import at all

All tools need filter support added:
1. `vm list` - Uses `applyFilters` on command
2. `vm info` - Uses `applyFilters` on command
3. `vm vnc info` - Uses `applyFiltersToText` on formatted result
4. `vm libvirt logs` - Uses `applyFilters` on command

### 6. unraid-tools.ts (5 tools)
**Current import:** No filter import at all

All tools need filter support added:
1. `unraid array status` - Uses `applyFiltersToText` on formatted output
2. `unraid drive smart status` - Uses `applyFilters` on command
3. `unraid check temperatures` - Uses `applyFiltersToText` on formatted output
4. `unraid shares list` - Uses `applyFilters` on command
5. `unraid share usage` - Uses `applyFilters` on command

### 7. unraid-array-tools.ts (9 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on formatted output:
1. `unraid parity check status`
2. `unraid parity check history`
3. `unraid array sync status`
4. `unraid disk spin status`
5. `unraid unclean shutdown check`
6. `unraid mover status`
7. `unraid mover log`
8. `unraid cache usage`
9. `unraid check split level`

### 8. container-topology-tools.ts (8 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on formatted result:
1. `container network topology`
2. `container volume sharing`
3. `container dependency graph`
4. `container port conflict check`
5. `container communication test`
6. `container dns test`
7. `container ping test`
8. `container traceroute test`

### 9. plugin-config-tools.ts (7 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on formatted output:
1. `plugin list plugins`
2. `plugin check plugin updates`
3. `plugin read docker template`
4. `plugin list user scripts`
5. `plugin validate docker compose`
6. `plugin check share config`
7. `plugin check disk assignments`
8. `plugin find recent changes`

### 10. performance-security-tools.ts (7 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on formatted analysis:
1. `performance identify bottleneck`
2. `performance network bandwidth by container`
3. `performance track metric over time`
4. `security check open ports`
5. `security audit container privileges`
6. `security check ssh connections`
7. `security check cert expiry`

### 11. log-analysis-tools.ts (6 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on aggregated results:
1. `log grep all logs`
2. `log error aggregator`
3. `log timeline`
4. `log parse docker logs`
5. `log compare logs timerange`
6. `log container restart history`

### 12. resource-management-tools.ts (6 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on formatted report:
1. `resource find dangling resources`
2. `resource find resource hogs`
3. `resource disk space analyzer`
4. `resource docker system df`
5. `resource find zombie processes`
6. `resource container io profile`

### 13. health-diagnostics-tools.ts (6 tools)
**Current import:** No filter import at all

All tools need filter support added - all use `applyFiltersToText` on formatted report:
1. `health check comprehensive`
2. `health detect common issues`
3. `health threshold alerts`
4. `health compare baseline`
5. `health generate diagnostic report`
6. `health snapshot system state`

## Update Pattern

For each file, follow this pattern:

### 1. Update Import Statement
```typescript
// OLD:
import { applyGrepFilter } from "./utils.js";

// NEW:
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";

// OR if no import exists, add after McpServer import:
import { applyFilters, applyFiltersToText, outputFiltersSchema } from "./filters.js";
```

### 2. For Each Tool, Update Parameters
```typescript
// Add to parameters object:
{
  existingParam: z.string().describe("..."),
  ...outputFiltersSchema.shape,  // ADD THIS
}
```

### 3. Update Tool Description
Add "Supports comprehensive output filtering." to the end of the description.

### 4. Apply Filters in Tool Implementation

**For raw command output (use `applyFilters` on command):**
```typescript
let command = `docker top ${args.container}`;
command = applyFilters(command, args);
const output = await sshExecutor(command);
```

**For formatted/parsed output (use `applyFiltersToText` on final text):**
```typescript
const formatted = containers.map(c => `...`).join("\n");
const filtered = applyFiltersToText(formatted, args);
return { content: [{ type: "text", text: filtered }] };
```

### 5. Remove Old Grep Handling
Remove any manual grep parameter handling:
```typescript
// REMOVE:
grep: z.string().optional().describe("Optional grep pattern"),
grepCaseSensitive: z.boolean().optional(),

// REMOVE:
command = applyGrepFilter(command, {
  pattern: args.grep,
  caseSensitive: args.grepCaseSensitive,
});
```

## Statistics

- **Total Files:** 13
- **Files Completed:** 2 (docker-advanced-tools.ts, system-tools.ts)
- **Files Remaining:** 11
- **Total Tools Updated:** 11 (6 + 5)
- **Total Tools Remaining:** 63
- **Tools Removed:** 1 (system tail log)
- **Total Tools After Update:** 73

## Decision: Command vs Text Filtering

**Use `applyFilters` (command-level) when:**
- Tool executes a simple command and returns raw output
- Examples: `docker top`, `ls`, `df`, `virsh list`

**Use `applyFiltersToText` (text-level) when:**
- Tool parses/formats output before returning
- Tool aggregates data from multiple sources
- Tool returns JSON-formatted or structured output
- Examples: Health checks, topology analysis, formatted reports
