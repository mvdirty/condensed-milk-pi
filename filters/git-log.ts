/**
 * git log (verbose format) filter.
 *
 * When the model runs `git log` without `--oneline`, strips Author/Date/Merge
 * headers and commit bodies, emitting only "hash subject" per commit.
 * Passthrough for --oneline output (already compact).
 * Caps at 50 commits.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

function filterGitLog(input: string): FilterResult | null {
  if (input.length === 0) return null;

  // Detect if this is already --oneline format (no "commit " headers)
  if (!input.includes("commit ") || !input.includes("Author:")) {
    return null; // Already compact
  }

  const lines = input.split("\n");
  const out: string[] = [];
  let commits = 0;
  let i = 0;

  while (i < lines.length && commits < 50) {
    const line = lines[i];

    if (isCommitHeader(line)) {
      const hash = line.slice(7, 14);
      const subject = findSubject(lines, i + 1);
      out.push(`${hash} ${subject}`);
      commits++;
    }
    i++;
  }

  if (out.length === 0) return null;

  const result = out.join("\n");
  return result.length < input.length ? { output: result, category: "slow" } : null;
}

function isCommitHeader(line: string): boolean {
  if (!line.startsWith("commit ")) return false;
  const rest = line.slice(7);
  if (rest.length < 40) return false;
  return /^[0-9a-f]{40}/.test(rest);
}

function findSubject(lines: string[], startIdx: number): string {
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (isCommitHeader(line)) return "(no subject)";
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (isMetadataLine(trimmed)) continue;
    return trimmed.length > 72 ? trimmed.slice(0, 72) + "..." : trimmed;
  }
  return "(no subject)";
}

function isMetadataLine(line: string): boolean {
  return (
    line.startsWith("Author:") ||
    line.startsWith("Date:") ||
    line.startsWith("Merge:") ||
    line.startsWith("Signed-off-by:") ||
    line.startsWith("Co-authored-by:") ||
    line.startsWith("Reviewed-by:")
  );
}

registerFilter("git log", filterGitLog, "slow");
