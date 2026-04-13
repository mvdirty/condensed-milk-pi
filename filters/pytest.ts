/**
 * pytest output filter.
 *
 * All-pass: extract summary line → "pytest: 107 passed in 2.3s"
 * Failures: keep failure blocks (max 5) + summary. Drop headers/progress dots.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

type State = "header" | "progress" | "failures" | "summary";

function filterPytest(input: string): FilterResult | null {
  if (input.length === 0) return null;

  // Fast path: all tests passed — no FAILED or ERROR anywhere
  if (!input.includes("FAILED") && !input.includes("ERROR")) {
    const summary = extractPassSummary(input);
    if (summary) return { output: summary, category: "medium" };
    return null;
  }

  // Failure path: state machine to extract failures + summary
  const lines = input.split("\n");
  const out: string[] = [];
  let state: State = "header";
  let failureBlocks = 0;

  for (const line of lines) {
    state = transition(state, line);
    switch (state) {
      case "header":
      case "progress":
        continue;
      case "failures":
        if (line.startsWith("___")) failureBlocks++;
        if (failureBlocks <= 5) out.push(line);
        break;
      case "summary":
        if (failureBlocks > 5) {
          out.push(`+${failureBlocks - 5} more failures`);
          failureBlocks = 0;
        }
        out.push(line);
        break;
    }
  }

  const result = out.join("\n").trim();
  return result.length > 0 ? { output: result, category: "medium" } : null;
}

function transition(current: State, line: string): State {
  if (line.startsWith("=")) {
    if (line.includes("FAILURES")) return "failures";
    if (line.includes("short test summary")) return "summary";
    if (line.includes("passed") || line.includes("failed")) return "summary";
    if (line.includes("test session starts")) return "header";
  }
  if (isProgressLine(line)) return "progress";
  return current;
}

function isProgressLine(line: string): boolean {
  if (line.length === 0) return false;
  for (const ch of line) {
    if (ch !== "." && ch !== "F" && ch !== "E" && ch !== "s" && ch !== "x") return false;
  }
  return true;
}

function extractPassSummary(input: string): string | null {
  let lastPassed: string | null = null;
  for (const line of input.split("\n")) {
    // Match pytest summary: "N passed" with optional skipped/warnings/time
    // Avoid false matches like ruff's "All checks passed!"
    if (/\d+\s+passed/.test(line)) lastPassed = line;
  }
  if (lastPassed) {
    const cleaned = lastPassed.replace(/^[= ]+|[= ]+$/g, "").trim();
    return `pytest: ${cleaned}`;
  }
  return null;
}

// Register
registerFilter("pytest", filterPytest, "medium");
registerFilter("python -m pytest", filterPytest, "medium");
registerFilter("python3 -m pytest", filterPytest, "medium");
