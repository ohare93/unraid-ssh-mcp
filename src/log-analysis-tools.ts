import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFilters, outputFiltersSchema } from "./filters.js";

/**
 * SSH executor function type that executes commands on remote host
 */
type SSHExecutor = (command: string) => Promise<string>;

/**
 * Register all log analysis tools with the MCP server
 * All tools are READ-ONLY and safe for monitoring operations
 */
export function registerLogAnalysisTools(
  server: McpServer,
  sshExecutor: SSHExecutor
): void {
  // Tool 1: log grep all logs - Search across all logs
  server.tool(
    "log grep all logs",
    "Search across all system logs including syslog, docker container logs, and application logs in /var/log/. Aggregates results showing source and matches. Supports comprehensive output filtering.",
    {
      pattern: z
        .string()
        .describe("The search pattern to look for in logs"),
      caseSensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether the search should be case-sensitive (default: false)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const grepFlags = args.caseSensitive ? "" : "-i";

        // Build a comprehensive search command
        // 1. Search syslog
        // 2. Search all docker container logs
        // 3. Search common application logs in /var/log/
        let command = `
          echo "=== SYSLOG ===" && \
          (grep ${grepFlags} "${args.pattern}" /var/log/syslog 2>/dev/null | tail -n 50 || echo "No matches in syslog") && \
          echo "" && \
          echo "=== DOCKER LOGS ===" && \
          (for container in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do \
            echo "--- Container: $container ---"; \
            docker logs --tail 100 "$container" 2>&1 | grep ${grepFlags} "${args.pattern}" | head -n 20 || echo "No matches"; \
          done) && \
          echo "" && \
          echo "=== APPLICATION LOGS ===" && \
          (find /var/log -type f -readable 2>/dev/null | while read logfile; do \
            matches=$(grep ${grepFlags} "${args.pattern}" "$logfile" 2>/dev/null | head -n 10); \
            if [ ! -z "$matches" ]; then \
              echo "--- $logfile ---"; \
              echo "$matches"; \
            fi; \
          done | head -n 100 || echo "No matches in application logs")
        `.replace(/\n/g, ' ');

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Log Search Results for "${args.pattern}" (case-${args.caseSensitive ? 'sensitive' : 'insensitive'}):\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error searching logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 2: log error aggregator - Find and deduplicate errors
  server.tool(
    "log error aggregator",
    "Find and deduplicate errors from logs in the last N hours. Searches for 'error', 'fail', 'exception', 'critical' patterns and groups identical errors with counts. Supports comprehensive output filtering.",
    {
      hours: z
        .number()
        .int()
        .positive()
        .optional()
        .default(24)
        .describe("Number of hours to look back (default: 24)"),
      minCount: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1)
        .describe("Minimum occurrence count to include (default: 1)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const hours = args.hours ?? 24;
        const minCount = args.minCount ?? 1;

        // Search for error patterns in syslog and docker logs
        // Use sort | uniq -c to deduplicate and count
        let command = `
          tmpfile=$(mktemp) && \
          (journalctl --since "${hours} hours ago" 2>/dev/null | grep -iE "(error|fail|exception|critical)" || true) >> "$tmpfile" && \
          (grep -iE "(error|fail|exception|critical)" /var/log/syslog 2>/dev/null | tail -n 1000 || true) >> "$tmpfile" && \
          (for container in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do \
            docker logs --since ${hours}h "$container" 2>&1 | grep -iE "(error|fail|exception|critical)" | sed "s/^/[$container] /"; \
          done || true) >> "$tmpfile" && \
          echo "=== ERROR SUMMARY (Last ${hours} hours) ===" && \
          echo "" && \
          sort "$tmpfile" | uniq -c | sort -rn | awk '{if ($1 >= ${minCount}) print $0}' | head -n 100 && \
          rm -f "$tmpfile" && \
          echo "" && \
          echo "=== STATISTICS ===" && \
          total_errors=$(wc -l < "$tmpfile" 2>/dev/null || echo 0) && \
          echo "Total error lines found: $total_errors" && \
          unique_errors=$(sort "$tmpfile" | uniq | wc -l 2>/dev/null || echo 0) && \
          echo "Unique error patterns: $unique_errors"
        `.replace(/\n/g, ' ');

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Error Aggregation (Last ${hours} hours, min count: ${minCount}):\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error aggregating errors: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 3: log timeline - Timeline of significant events
  server.tool(
    "log timeline",
    "Create a chronological timeline of significant events including container starts/stops, errors, array events, and mover runs in the last N hours. Supports comprehensive output filtering.",
    {
      hours: z
        .number()
        .int()
        .positive()
        .optional()
        .default(24)
        .describe("Number of hours to look back (default: 24)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const hours = args.hours ?? 24;

        // Extract significant events from various sources
        let command = `
          echo "=== TIMELINE OF SIGNIFICANT EVENTS (Last ${hours} hours) ===" && \
          echo "" && \
          tmpfile=$(mktemp) && \
          (journalctl --since "${hours} hours ago" --no-pager 2>/dev/null | \
            grep -E "(Started|Stopped|Created|Removed|error|fail|mover|array)" | \
            awk '{print $1, $2, $3, substr($0, index($0,$4))}' || true) >> "$tmpfile" && \
          (tail -n 2000 /var/log/syslog 2>/dev/null | \
            grep -E "(docker|Started|Stopped|error|fail|mover|array)" | \
            awk '{print $1, $2, $3, substr($0, index($0,$4))}' || true) >> "$tmpfile" && \
          (for container in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do \
            state=$(docker inspect -f "{{.State.Status}}" "$container" 2>/dev/null); \
            started=$(docker inspect -f "{{.State.StartedAt}}" "$container" 2>/dev/null | cut -d. -f1); \
            echo "Container $container: $state (started: $started)"; \
          done || true) >> "$tmpfile" && \
          sort "$tmpfile" | tail -n 200 && \
          rm -f "$tmpfile"
        `.replace(/\n/g, ' ');

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Event Timeline (Last ${hours} hours):\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error generating timeline: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 4: log parse docker logs - Parse structured logs
  server.tool(
    "log parse docker logs",
    "Parse and pretty-print Docker container logs. Can detect and parse JSON-formatted logs for better readability. Supports comprehensive output filtering.",
    {
      container: z
        .string()
        .describe("Name or ID of the container"),
      jsonLines: z
        .boolean()
        .optional()
        .default(false)
        .describe("Attempt to parse logs as JSON lines (default: false, auto-detect)"),
      lines: z
        .number()
        .int()
        .positive()
        .optional()
        .default(100)
        .describe("Number of log lines to retrieve (default: 100)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const lines = args.lines ?? 100;

        // First get the logs
        let command = `docker logs --tail ${lines} "${args.container}" 2>&1`;

        // If JSON parsing is requested or auto-detect, try to parse
        if (args.jsonLines) {
          command = `
            docker logs --tail ${lines} "${args.container}" 2>&1 | \
            while IFS= read -r line; do \
              echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"; \
            done
          `.replace(/\n/g, ' ');
        } else {
          // Auto-detect JSON - check first line
          command = `
            logs=$(docker logs --tail ${lines} "${args.container}" 2>&1) && \
            first_line=$(echo "$logs" | head -n 1) && \
            if echo "$first_line" | python3 -c "import sys, json; json.loads(sys.stdin.read())" 2>/dev/null; then \
              echo "=== JSON LOGS DETECTED - Pretty-printing ===" && \
              echo "" && \
              echo "$logs" | while IFS= read -r line; do \
                echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"; \
              done; \
            else \
              echo "$logs"; \
            fi
          `.replace(/\n/g, ' ');
        }

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Docker Logs for "${args.container}" (last ${lines} lines):\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error parsing docker logs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 5: log compare logs timerange - Events between times
  server.tool(
    "log compare logs timerange",
    "Show all significant events that occurred between two specific times. Helps answer 'what happened between X and Y?' Uses journalctl and syslog. Supports comprehensive output filtering.",
    {
      startTime: z
        .string()
        .describe("Start time in format like '2025-01-15 10:30:00' or '10 minutes ago' or '1 hour ago'"),
      endTime: z
        .string()
        .describe("End time in format like '2025-01-15 11:30:00' or '5 minutes ago' or 'now'"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        // Use journalctl for precise time range queries
        let command = `
          echo "=== EVENTS FROM ${args.startTime} TO ${args.endTime} ===" && \
          echo "" && \
          (journalctl --since "${args.startTime}" --until "${args.endTime}" --no-pager 2>/dev/null || \
            echo "journalctl not available, using syslog...") && \
          echo "" && \
          echo "=== DOCKER EVENTS IN TIMERANGE ===" && \
          (docker events --since "${args.startTime}" --until "${args.endTime}" --filter "type=container" 2>/dev/null | head -n 100 || \
            echo "Could not retrieve docker events for timerange") && \
          echo "" && \
          echo "=== CONTAINER STATES AT END TIME ===" && \
          (for container in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do \
            state=$(docker inspect -f "{{.State.Status}}" "$container" 2>/dev/null); \
            started=$(docker inspect -f "{{.State.StartedAt}}" "$container" 2>/dev/null | cut -d. -f1); \
            echo "  $container: $state (started: $started)"; \
          done || echo "Could not retrieve container states")
        `.replace(/\n/g, ' ');

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Events Between ${args.startTime} and ${args.endTime}:\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error comparing logs in timerange: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Tool 6: log container restart history - Recent container restarts
  server.tool(
    "log container restart history",
    "Show which containers have restarted in the last N hours and why. Parses docker events and syslog for restart information. Supports comprehensive output filtering.",
    {
      hours: z
        .number()
        .int()
        .positive()
        .optional()
        .default(24)
        .describe("Number of hours to look back (default: 24)"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        const hours = args.hours ?? 24;

        let command = `
          echo "=== CONTAINER RESTART HISTORY (Last ${hours} hours) ===" && \
          echo "" && \
          echo "=== DOCKER EVENTS (Restarts) ===" && \
          (journalctl --since "${hours} hours ago" --no-pager 2>/dev/null | \
            grep -i "restart" | grep -i "docker" || \
            echo "No restart events in journalctl") && \
          echo "" && \
          echo "=== CONTAINER RESTART COUNTS ===" && \
          (for container in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do \
            restart_count=$(docker inspect -f "{{.RestartCount}}" "$container" 2>/dev/null); \
            state=$(docker inspect -f "{{.State.Status}}" "$container" 2>/dev/null); \
            started=$(docker inspect -f "{{.State.StartedAt}}" "$container" 2>/dev/null | cut -d. -f1); \
            finished=$(docker inspect -f "{{.State.FinishedAt}}" "$container" 2>/dev/null | cut -d. -f1); \
            exit_code=$(docker inspect -f "{{.State.ExitCode}}" "$container" 2>/dev/null); \
            echo "Container: $container"; \
            echo "  Status: $state"; \
            echo "  Restart Count: $restart_count"; \
            echo "  Last Started: $started"; \
            echo "  Last Finished: $finished"; \
            echo "  Exit Code: $exit_code"; \
            echo ""; \
          done) && \
          echo "=== RECENT CONTAINER LOGS (Checking for restart causes) ===" && \
          (for container in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do \
            restart_count=$(docker inspect -f "{{.RestartCount}}" "$container" 2>/dev/null); \
            if [ "$restart_count" -gt 0 ]; then \
              echo "--- Logs for $container (restart count: $restart_count) ---"; \
              docker logs --tail 20 "$container" 2>&1 | grep -iE "(error|fail|exit|fatal|panic)" | tail -n 10; \
              echo ""; \
            fi; \
          done | head -n 200)
        `.replace(/\n/g, ' ');

        command = applyFilters(command, args);
        const output = await sshExecutor(command);

        return {
          content: [
            {
              type: "text",
              text: `Container Restart History (Last ${hours} hours):\n\n${output}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting container restart history: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
