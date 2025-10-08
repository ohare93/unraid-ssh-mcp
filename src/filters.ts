import { z } from "zod";

/**
 * Comprehensive output filtering options for command results
 * These filters are applied server-side before returning results to reduce bandwidth
 */
export interface OutputFilters {
  /** Pattern to search for (grep). If provided, only matching lines are returned */
  grep?: string;

  /** Whether grep should be case-sensitive (default: false) */
  grepCaseSensitive?: boolean;

  /** Get only the first N lines of output (mutually exclusive with tail) */
  head?: number;

  /** Get only the last N lines of output (mutually exclusive with head) */
  tail?: number;

  /** Sort the output lines. Use 'reverse' for descending sort */
  sort?: boolean | 'reverse';

  /** Remove consecutive duplicate lines (like uniq) */
  uniq?: boolean;

  /** Count lines, words, or characters instead of returning content */
  wc?: 'lines' | 'words' | 'chars';
}

/**
 * Zod schema for output filters that can be spread into tool parameter definitions
 *
 * @example
 * ```ts
 * server.tool("my-tool", "Description", {
 *   myParam: z.string(),
 *   ...outputFiltersSchema.shape,
 * }, async (args) => { ... });
 * ```
 */
export const outputFiltersSchema = z.object({
  grep: z.string().optional().describe(
    "Pattern to search for in output (grep). " +
    "RECOMMENDED: Use filters to reduce output size and minimize context usage. " +
    "Case-insensitive by default unless grepCaseSensitive=true. " +
    "Example: grep='error' to find only error messages. " +
    "Combine with head/tail for best results."
  ),
  grepCaseSensitive: z.boolean().optional().default(false).describe(
    "Whether grep should be case-sensitive (default: false). " +
    "Set to true for exact case matching."
  ),
  head: z.number().int().positive().optional().describe(
    "Get only the first N lines of output (mutually exclusive with tail). " +
    "BEST PRACTICE: Always use head or tail to limit output and reduce context. " +
    "Example: head=20 to see first 20 results. " +
    "Combine with grep to filter first, then limit."
  ),
  tail: z.number().int().positive().optional().describe(
    "Get only the last N lines of output (mutually exclusive with head). " +
    "BEST PRACTICE: Always use head or tail to limit output and reduce context. " +
    "Example: tail=50 for recent log entries. " +
    "Combine with grep to filter first, then show last N matches."
  ),
  sort: z.union([z.boolean(), z.literal('reverse')]).optional().describe(
    "Sort output lines alphabetically. Use 'reverse' for descending sort, true for ascending. " +
    "Useful for organizing results before limiting with head/tail. " +
    "Example: sort='reverse' + head=10 for top 10 alphabetically."
  ),
  uniq: z.boolean().optional().describe(
    "Remove consecutive duplicate lines (like uniq command). " +
    "Use with sort=true to remove all duplicates. " +
    "Reduces redundant output and context size."
  ),
  wc: z.enum(['lines', 'words', 'chars']).optional().describe(
    "Count lines, words, or characters instead of returning full content. " +
    "CONTEXT OPTIMIZATION: Use wc='lines' when you only need to know 'how many'. " +
    "Example: wc='lines' with grep='running' counts running containers without showing them all."
  ),
});

/**
 * Apply comprehensive output filters to a command
 *
 * Filters are applied in this order:
 * 1. Base command execution
 * 2. grep (pattern matching)
 * 3. sort
 * 4. uniq (remove duplicates)
 * 5. head OR tail (mutually exclusive)
 * 6. wc (count - if specified, only count is returned)
 *
 * @param command - The base command to execute
 * @param filters - Filter options to apply
 * @returns The command with filters appended as a shell pipeline
 * @throws Error if both head and tail are specified
 *
 * @example
 * ```ts
 * const cmd = applyFilters("docker logs mycontainer", {
 *   grep: "error",
 *   tail: 50,
 *   sort: true
 * });
 * // Returns: "docker logs mycontainer | grep -i 'error' | sort | tail -n 50"
 * ```
 */
export function applyFilters(command: string, filters: OutputFilters): string {
  // Validate mutually exclusive options
  if (filters.head !== undefined && filters.tail !== undefined) {
    throw new Error("Cannot specify both 'head' and 'tail' filters - they are mutually exclusive");
  }

  let result = command;

  // 1. Apply grep filter
  if (filters.grep) {
    const escapedPattern = filters.grep.replace(/'/g, "'\\''");
    const grepFlags = filters.grepCaseSensitive ? "" : "-i";
    result += ` | grep ${grepFlags} '${escapedPattern}'`.trim();
  }

  // 2. Apply sort
  if (filters.sort) {
    const sortFlags = filters.sort === 'reverse' ? ' -r' : '';
    result += ` | sort${sortFlags}`;
  }

  // 3. Apply uniq
  if (filters.uniq) {
    result += ` | uniq`;
  }

  // 4. Apply head OR tail
  if (filters.head !== undefined) {
    result += ` | head -n ${filters.head}`;
  } else if (filters.tail !== undefined) {
    result += ` | tail -n ${filters.tail}`;
  }

  // 5. Apply wc (word count)
  if (filters.wc) {
    const wcFlag = filters.wc === 'lines' ? '-l' : filters.wc === 'words' ? '-w' : '-c';
    result += ` | wc ${wcFlag}`;
  }

  return result;
}

/**
 * Apply filters to text that has already been fetched (client-side filtering)
 * Use this for commands that parse and format output before filtering
 *
 * @param text - The text to filter
 * @param filters - Filter options to apply
 * @returns The filtered text
 * @throws Error if both head and tail are specified
 */
export function applyFiltersToText(text: string, filters: OutputFilters): string {
  // Validate mutually exclusive options
  if (filters.head !== undefined && filters.tail !== undefined) {
    throw new Error("Cannot specify both 'head' and 'tail' filters - they are mutually exclusive");
  }

  let lines = text.split('\n');

  // 1. Apply grep filter
  if (filters.grep) {
    const flags = filters.grepCaseSensitive ? '' : 'i';
    const regex = new RegExp(filters.grep, flags);
    lines = lines.filter(line => regex.test(line));
  }

  // 2. Apply sort
  if (filters.sort) {
    lines = [...lines].sort();
    if (filters.sort === 'reverse') {
      lines.reverse();
    }
  }

  // 3. Apply uniq
  if (filters.uniq) {
    const uniqueLines: string[] = [];
    let lastLine: string | null = null;
    for (const line of lines) {
      if (line !== lastLine) {
        uniqueLines.push(line);
        lastLine = line;
      }
    }
    lines = uniqueLines;
  }

  // 4. Apply head OR tail
  if (filters.head !== undefined) {
    lines = lines.slice(0, filters.head);
  } else if (filters.tail !== undefined) {
    lines = lines.slice(-filters.tail);
  }

  // 5. Apply wc (word count)
  if (filters.wc) {
    const text = lines.join('\n');
    if (filters.wc === 'lines') {
      return lines.length.toString();
    } else if (filters.wc === 'words') {
      return text.split(/\s+/).filter(w => w.length > 0).length.toString();
    } else { // chars
      return text.length.toString();
    }
  }

  return lines.join('\n');
}
