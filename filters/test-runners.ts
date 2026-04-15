/**
 * Generic test runner filter for vitest, jest, mocha, npm test, etc.
 * Extracts pass/fail/skip counts and failure details.
 * pytest is handled separately by pytest.ts.
 *
 * Adapted from MasuRii/pi-rtk-optimizer techniques/test-output.ts
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const RESULT_PATTERNS: readonly RegExp[] = [
  // vitest/jest: "Tests: 3 passed, 1 failed, 4 total"
  /Tests?:\s*(\d+)\s*passed(?:,\s*(\d+)\s*failed)?(?:,\s*(\d+)\s*(?:skipped|todo))?/i,
  // generic: "5 passed, 2 failed"
  /(\d+)\s*pass(?:ed)?(?:,\s*(\d+)\s*fail(?:ed)?)?(?:,\s*(\d+)\s*skip(?:ped)?)?/i,
  // cargo test: "test result: ok. 10 passed; 0 failed"
  /test result:\s*\w+\.\s*(\d+)\s*passed;\s*(\d+)\s*failed/,
  // go test: "ok" or "FAIL"
  /^(ok|FAIL)\s+\S+\s+([\d.]+)s$/m,
];

const FAILURE_START_PATTERNS: readonly RegExp[] = [
  /^FAIL\s+/,
  /^FAILED\s+/,
  /^\s*●\s+/,           // jest
  /^\s*✕\s+/,           // vitest
  /^\s*×\s+/,           // vitest alt
  /^\s*❯\s+.*FAIL/,     // vitest v2
  /^AssertionError/i,
  /thread\s+'\w+'\s+panicked/,  // cargo test
];

function extractStats(output: string): { passed: number; failed: number; skipped: number } {
  for (const pattern of RESULT_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      return {
        passed: Number.parseInt(match[1] ?? "0", 10) || 0,
        failed: Number.parseInt(match[2] ?? "0", 10) || 0,
        skipped: Number.parseInt(match[3] ?? "0", 10) || 0,
      };
    }
  }

  // Fallback: count indicators
  let passed = 0, failed = 0;
  for (const line of output.split("\n")) {
    if (/\b(ok|PASS|✓|✔)\b/.test(line)) passed++;
    if (/\b(FAIL|fail|✗|✕|×)\b/.test(line)) failed++;
  }
  return { passed, failed, skipped: 0 };
}

function extractFailures(lines: string[]): string[] {
  const failures: string[] = [];
  let inFailure = false;
  let current: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (FAILURE_START_PATTERNS.some((p) => p.test(line))) {
      if (inFailure && current.length > 0) failures.push(current.join("\n"));
      inFailure = true;
      current = [line];
      blankCount = 0;
      continue;
    }

    if (!inFailure) continue;

    if (line.trim() === "") {
      blankCount++;
      if (blankCount >= 2 && current.length > 3) {
        failures.push(current.join("\n"));
        inFailure = false;
        current = [];
      }
      continue;
    }

    if (line.match(/^\s/) || line.match(/^-/) || line.match(/^at\s/)) {
      current.push(line);
      blankCount = 0;
      continue;
    }

    failures.push(current.join("\n"));
    inFailure = false;
    current = [];
  }

  if (inFailure && current.length > 0) failures.push(current.join("\n"));
  return failures;
}

function filterTestOutput(stdout: string, _command: string): FilterResult | null {
  const lines = stdout.split("\n");
  if (lines.length < 10) return null;

  const stats = extractStats(stdout);
  if (stats.passed === 0 && stats.failed === 0) return null;

  const result: string[] = [`Test Results: ${stats.passed} passed`];
  if (stats.failed > 0) result.push(`  ${stats.failed} failed`);
  if (stats.skipped > 0) result.push(`  ${stats.skipped} skipped`);

  if (stats.failed > 0) {
    const failures = extractFailures(lines);
    if (failures.length > 0) {
      result.push("Failures:");
      for (const f of failures.slice(0, 5)) {
        const fLines = f.split("\n");
        const first = fLines[0] ?? "";
        result.push(`  - ${first.length > 70 ? first.slice(0, 67) + "..." : first}`);
        for (const detail of fLines.slice(1, 4)) {
          if (detail.trim()) {
            result.push(`    ${detail.length > 65 ? detail.slice(0, 62) + "..." : detail}`);
          }
        }
        if (fLines.length > 4) result.push(`    ... (${fLines.length - 4} more lines)`);
      }
      if (failures.length > 5) result.push(`  ... +${failures.length - 5} more failures`);
    }
  }

  return { output: result.join("\n"), category: "medium" };
}

// Register for test runner prefixes (pytest handled by pytest.ts)
const TEST_COMMANDS = [
  "npm test", "pnpm test", "yarn test", "bun test",
  "npx vitest", "vitest", "pnpm vitest",
  "npx jest", "jest", "pnpm jest",
  "mocha", "npx mocha",
  "cargo test",
  "go test",
];

for (const cmd of TEST_COMMANDS) {
  registerFilter(cmd, filterTestOutput, "medium");
}
