import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { applyFiltersToText, outputFiltersSchema } from "../../filters.js";

type SSHExecutor = (command: string) => Promise<string>;

const logActions = ["grep_all", "error_aggregator", "timeline", "parse_docker", "compare_timerange", "restart_history"] as const;

export function registerLogAnalysisTools(server: McpServer, sshExecutor: SSHExecutor): void {
  server.tool(
    "log",
    "Log analysis ops.",
    {
      action: z.enum(logActions).describe("Action"),
      pattern: z.string().optional().describe("Search pattern"),
      caseSensitive: z.boolean().optional().default(false).describe("Case-sensitive"),
      hours: z.number().int().positive().optional().default(24).describe("Hours"),
      minCount: z.number().int().positive().optional().default(1).describe("Min count"),
      container: z.string().optional().describe("Container"),
      jsonLines: z.boolean().optional().default(false).describe("Force JSON"),
      lines: z.number().int().positive().optional().default(100).describe("Lines"),
      startTime: z.string().optional().describe("Start time"),
      endTime: z.string().optional().describe("End time"),
      ...outputFiltersSchema.shape,
    },
    async (args) => {
      try {
        switch (args.action) {
          case "grep_all": {
            if (!args.pattern) return { content: [{ type: "text", text: "Error: pattern required" }], isError: true };
            const grepFlags = args.caseSensitive ? "" : "-i";
            const cmd = `echo "=== SYSLOG ===" && (grep ${grepFlags} "${args.pattern}" /var/log/syslog 2>/dev/null | tail -n 50 || echo "No matches") && echo "" && echo "=== DOCKER ===" && (for c in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do echo "--- $c ---"; docker logs --tail 100 "$c" 2>&1 | grep ${grepFlags} "${args.pattern}" | head -n 20 || echo "No matches"; done)`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Search "${args.pattern}":\n\n${output}`, args) }] };
          }

          case "error_aggregator": {
            const hours = args.hours ?? 24;
            const minCount = args.minCount ?? 1;
            const cmd = `tmpfile=$(mktemp) && (journalctl --since "${hours} hours ago" 2>/dev/null | grep -iE "(error|fail|exception|critical)" || true) >> "$tmpfile" && (grep -iE "(error|fail|exception|critical)" /var/log/syslog 2>/dev/null | tail -n 1000 || true) >> "$tmpfile" && (for c in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do docker logs --since ${hours}h "$c" 2>&1 | grep -iE "(error|fail|exception|critical)" | sed "s/^/[$c] /"; done || true) >> "$tmpfile" && echo "=== ERROR SUMMARY (${hours}h) ===" && sort "$tmpfile" | uniq -c | sort -rn | awk '{if ($1 >= ${minCount}) print $0}' && rm -f "$tmpfile"`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Errors (${hours}h, min: ${minCount}):\n\n${output}`, args) }] };
          }

          case "timeline": {
            const hours = args.hours ?? 24;
            const cmd = `echo "=== TIMELINE (${hours}h) ===" && tmpfile=$(mktemp) && (journalctl --since "${hours} hours ago" --no-pager 2>/dev/null | grep -E "(Started|Stopped|Created|Removed|error|fail|mover|array)" | awk '{print $1, $2, $3, substr($0, index($0,$4))}' || true) >> "$tmpfile" && (tail -n 2000 /var/log/syslog 2>/dev/null | grep -E "(docker|Started|Stopped|error|fail|mover|array)" || true) >> "$tmpfile" && sort "$tmpfile" && rm -f "$tmpfile"`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "parse_docker": {
            if (!args.container) return { content: [{ type: "text", text: "Error: container required" }], isError: true };
            const lines = args.lines ?? 100;
            let cmd: string;
            if (args.jsonLines) {
              cmd = `docker logs --tail ${lines} "${args.container}" 2>&1 | while IFS= read -r line; do echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"; done`;
            } else {
              cmd = `logs=$(docker logs --tail ${lines} "${args.container}" 2>&1) && first_line=$(echo "$logs" | head -n 1) && if echo "$first_line" | python3 -c "import sys, json; json.loads(sys.stdin.read())" 2>/dev/null; then echo "=== JSON DETECTED ===" && echo "$logs" | while IFS= read -r line; do echo "$line" | python3 -m json.tool 2>/dev/null || echo "$line"; done; else echo "$logs"; fi`;
            }
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(`Logs "${args.container}" (${lines}):\n\n${output}`, args) }] };
          }

          case "compare_timerange": {
            if (!args.startTime || !args.endTime) return { content: [{ type: "text", text: "Error: startTime and endTime required" }], isError: true };
            const cmd = `echo "=== EVENTS ${args.startTime} to ${args.endTime} ===" && (journalctl --since "${args.startTime}" --until "${args.endTime}" --no-pager 2>/dev/null || echo "journalctl not available") && echo "" && echo "=== DOCKER EVENTS ===" && (docker events --since "${args.startTime}" --until "${args.endTime}" --filter "type=container" 2>/dev/null || echo "Could not retrieve")`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          case "restart_history": {
            const hours = args.hours ?? 24;
            const cmd = `echo "=== RESTART HISTORY (${hours}h) ===" && echo "" && echo "=== CONTAINER STATES ===" && (for c in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do restart_count=$(docker inspect -f "{{.RestartCount}}" "$c" 2>/dev/null); state=$(docker inspect -f "{{.State.Status}}" "$c" 2>/dev/null); started=$(docker inspect -f "{{.State.StartedAt}}" "$c" 2>/dev/null | cut -d. -f1); echo "$c: $state (restarts: $restart_count, started: $started)"; done) && echo "" && echo "=== RECENT RESTART LOGS ===" && (for c in $(docker ps -a --format "{{.Names}}" 2>/dev/null); do rc=$(docker inspect -f "{{.RestartCount}}" "$c" 2>/dev/null); if [ "$rc" -gt 0 ]; then echo "--- $c (restarts: $rc) ---"; docker logs --tail 20 "$c" 2>&1 | grep -iE "(error|fail|exit|fatal|panic)" | tail -n 10; fi; done)`;
            const output = await sshExecutor(cmd);
            return { content: [{ type: "text", text: applyFiltersToText(output, args) }] };
          }

          default:
            return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
        }
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
