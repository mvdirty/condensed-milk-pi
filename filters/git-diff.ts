/**
 * git diff output filter.
 *
 * - Passthrough for --stat output (already compact)
 * - Strip ---/+++ file headers (redundant with diff --git line)
 * - Passthrough small diffs (<10 lines after stripping)
 * - Condense large diffs: keep hunk headers + changed lines, drop unchanged context
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

function filterGitDiff(input: string): FilterResult | null {
  if (input.length === 0) return null;

  // Passthrough: --stat output is already compact
  if (
    !input.includes("diff --git") &&
    input.includes("|") &&
    input.includes("files changed") &&
    (input.includes("insertion") || input.includes("deletion"))
  ) {
    return null; // Already compact
  }

  // Strip ---/+++ metadata headers
  const stripped = stripFileHeaders(input);

  const lineCount = countLines(stripped);
  if (lineCount < 10) {
    return stripped.length < input.length
      ? { output: stripped, category: "fast" }
      : null;
  }

  // Condense large diffs: keep diff --git, hunk headers, and changed lines
  const condensed = condenseLargeDiff(stripped);
  return condensed.length < input.length
    ? { output: condensed, category: "fast" }
    : null;
}

function stripFileHeaders(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (isFileHeader(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}

function isFileHeader(line: string): boolean {
  if (line.length < 4) return false;
  return (
    (line[0] === "-" && line[1] === "-" && line[2] === "-" && line[3] === " ") ||
    (line[0] === "+" && line[1] === "+" && line[2] === "+" && line[3] === " ")
  );
}

function condenseLargeDiff(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];
  let contextRun = 0;
  const MAX_CONTEXT = 2; // Keep at most 2 context lines around changes

  for (const line of lines) {
    // Always keep structural lines
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("@@ ")
    ) {
      if (contextRun > MAX_CONTEXT) {
        out.push(`  ... ${contextRun - MAX_CONTEXT} unchanged lines ...`);
      }
      contextRun = 0;
      out.push(line);
      continue;
    }

    // Changed lines: always keep
    if (line.startsWith("+") || line.startsWith("-")) {
      if (contextRun > MAX_CONTEXT) {
        out.push(`  ... ${contextRun - MAX_CONTEXT} unchanged lines ...`);
      }
      contextRun = 0;
      out.push(line);
      continue;
    }

    // Context (unchanged) line
    contextRun++;
    if (contextRun <= MAX_CONTEXT) {
      out.push(line);
    }
  }

  if (contextRun > MAX_CONTEXT) {
    out.push(`  ... ${contextRun - MAX_CONTEXT} unchanged lines ...`);
  }

  return out.join("\n");
}

function countLines(s: string): number {
  let count = 0;
  for (const ch of s) {
    if (ch === "\n") count++;
  }
  return count;
}

// Register
registerFilter("git diff", filterGitDiff, "fast");
