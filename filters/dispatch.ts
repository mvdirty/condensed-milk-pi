/**
 * Filter dispatch — matches bash commands to compression filters.
 *
 * Each filter spec has a command prefix (e.g., "git status") and a filter
 * function that transforms stdout into a compressed representation.
 * Longest-prefix match wins, so "git status" beats "git".
 */

export interface FilterResult {
  output: string;
  category: "fast" | "medium" | "slow" | "immutable" | "mutation";
}

export type FilterFn = (input: string, command: string) => FilterResult | null;

interface FilterSpec {
  /** Command prefix to match (e.g., "git status", "pytest") */
  command: string;
  filter: FilterFn;
  category: FilterResult["category"];
}

const specs: FilterSpec[] = [];

/**
 * Register a filter for a command prefix.
 * Call this from individual filter modules at load time.
 */
export function registerFilter(
  command: string,
  filter: FilterFn,
  category: FilterResult["category"] = "fast",
): void {
  specs.push({ command, filter, category });
  // Keep sorted by command length descending for longest-prefix-first matching
  specs.sort((a, b) => b.command.length - a.command.length);
}

/**
 * Match a command string against registered filters and run the best match.
 * Returns null if no filter matches or the filter declines (returns null).
 *
 * Handles compound commands: "source .venv/bin/activate && python -m pytest -q"
 * is split on &&/||/; and each segment is checked. The LAST matching segment
 * wins (it produced the final output).
 */
export function dispatch(command: string, stdout: string): FilterResult | null {
  // Skip tiny outputs — compression overhead exceeds savings
  if (stdout.length < 80) return null;

  // Split compound commands and try each segment
  const segments = splitCompoundCommand(command);

  // Try segments in reverse — last command in chain produced the output
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i].trim();
    if (segment.length === 0) continue;

    // Strip redirects and env var prefixes
    const cleaned = cleanSegment(segment);
    if (cleaned.length === 0) continue;

    for (const spec of specs) {
      if (commandMatches(cleaned, spec.command)) {
        const result = spec.filter(stdout, cleaned);
        if (result && result.output.length < stdout.length) {
          return result;
        }
        return null; // Matched but filter declined or output grew
      }
    }
  }

  // No command-prefix match — try content-based fallbacks
  for (const fb of contentFallbacks) {
    const result = fb.filter(stdout, command);
    if (result && result.output.length < stdout.length) return result;
  }

  return null;
}

/**
 * Split a compound bash command on &&, ||, and ;.
 * Also strips trailing pipe chains (| head -5, | tail -3) since
 * those modify output before we see it but don't change the command identity.
 */
function splitCompoundCommand(command: string): string[] {
  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);
  return segments.map((seg) =>
    seg.replace(/\s*\|\s*(?:head|tail|wc|sort|uniq)\b.*$/i, "").trim(),
  );
}

/**
 * Strip leading env vars (FOO=bar), 2>&1 redirects, and source/cd noise.
 */
function cleanSegment(segment: string): string {
  let s = segment;
  s = s.replace(/\s*2>&1\s*/g, " ").trim();
  s = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+)+/, "").trim();
  return s;
}

/**
 * Matches when command equals spec exactly OR starts with spec followed by
 * a space/tab. So "git status -s" matches "git status" but "git statusfoo" doesn't.
 */
function commandMatches(command: string, spec: string): boolean {
  if (command.length < spec.length) return false;
  if (!command.startsWith(spec)) return false;
  return command.length === spec.length || command[spec.length] === " " || command[spec.length] === "\t";
}

// Content-based fallback filters (not command-prefix based)
let contentFallbacks: Array<{ name: string; filter: FilterFn }> = [];

/**
 * Register a content-based fallback filter that runs when no
 * command-prefix filter matches. Used for JSON detection, etc.
 */
export function registerContentFallback(name: string, filter: FilterFn): void {
  contentFallbacks.push({ name, filter });
}

/** List registered filter commands (for debugging/stats). */
export function registeredCommands(): string[] {
  return [...specs.map((s) => s.command), ...contentFallbacks.map((f) => `*${f.name}`)];
}
