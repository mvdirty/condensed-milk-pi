/**
 * Generic build output filter.
 * Strips progress noise (Compiling, Downloading, Building, etc.),
 * keeps errors, warnings, and summary lines.
 *
 * Adapted from MasuRii/pi-rtk-optimizer techniques/build.ts
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const SKIP_PATTERNS: readonly RegExp[] = [
  /^\s*Compiling\s+/,
  /^\s*Checking\s+/,
  /^\s*Downloading\s+/,
  /^\s*Downloaded\s+/,
  /^\s*Fetching\s+/,
  /^\s*Fetched\s+/,
  /^\s*Updating\s+/,
  /^\s*Updated\s+/,
  /^\s*Building\s+/,
  /^\s*Generated\s+/,
  /^\s*Creating\s+/,
  /^\s*Running\s+/,
  /^\s*Linking\s+/,
  /^\s*Bundling\s+/,
  /^\s*Resolving\s+/,
  /^\s*Installing\s+/,
  /^\s*Preparing\s+/,
  /^\s*Collecting\s+/,
  /^\s*Using\s+(cached|previously)\s+/,
  /^\s*\[[\d/]+\]\s+/,            // [1/42] progress counters
  /^\s*\d+%\s/,                    // percentage progress
  /^\s*\.\.\.\s*$/,                // bare dots
  /^\s*$/,                          // blank lines
];

const ERROR_PATTERNS: readonly RegExp[] = [
  /^error\[/, /^error:/i, /^\[ERROR\]/i, /^FAIL/i,
  /^E\s+/, /^ERROR\s/,
];

const WARNING_PATTERNS: readonly RegExp[] = [
  /^warning:/i, /^\[WARNING\]/i, /^warn:/i, /^W\s+/,
];

function isSkipLine(line: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(line));
}

function isErrorLine(line: string): boolean {
  return ERROR_PATTERNS.some((p) => p.test(line));
}

function isWarningLine(line: string): boolean {
  return WARNING_PATTERNS.some((p) => p.test(line));
}

function filterBuild(stdout: string, _command: string): FilterResult | null {
  const lines = stdout.split("\n");

  let skipped = 0;
  const errors: string[][] = [];
  const warnings: string[] = [];
  const kept: string[] = [];

  let inErrorBlock = false;
  let currentError: string[] = [];

  for (const line of lines) {
    if (isSkipLine(line)) {
      skipped++;
      continue;
    }

    if (isErrorLine(line)) {
      if (inErrorBlock && currentError.length > 0) {
        errors.push([...currentError]);
      }
      inErrorBlock = true;
      currentError = [line];
      continue;
    }

    if (isWarningLine(line)) {
      warnings.push(line);
      continue;
    }

    if (inErrorBlock) {
      // Continuation lines (indented or -->)
      if (line.match(/^\s/) || line.match(/^-->/)) {
        currentError.push(line);
        continue;
      }
      // End of error block
      errors.push([...currentError]);
      inErrorBlock = false;
      currentError = [];
    }

    kept.push(line);
  }

  if (inErrorBlock && currentError.length > 0) {
    errors.push(currentError);
  }

  // Only compress if we actually skipped significant noise
  if (skipped < 5) return null;

  const result: string[] = [];

  if (errors.length === 0 && warnings.length === 0) {
    result.push(`[OK] Build successful (${skipped} progress lines stripped)`);
    // Keep last 3 kept lines (usually the summary)
    if (kept.length > 0) {
      result.push(...kept.slice(-3));
    }
  } else {
    if (errors.length > 0) {
      result.push(`${errors.length} error(s):`);
      for (const err of errors.slice(0, 5)) {
        result.push(...err.slice(0, 10));
        if (err.length > 10) result.push("  ...");
      }
      if (errors.length > 5) result.push(`... +${errors.length - 5} more errors`);
    }

    if (warnings.length > 0) {
      result.push(`${warnings.length} warning(s):`);
      result.push(...warnings.slice(0, 5));
      if (warnings.length > 5) result.push(`... +${warnings.length - 5} more warnings`);
    }

    // Keep summary lines
    if (kept.length > 0) {
      result.push(...kept.slice(-3));
    }
  }

  result.push(`(${skipped} progress lines stripped)`);

  return { output: result.join("\n"), category: "medium" };
}

// Register for all build command prefixes
const BUILD_COMMANDS = [
  "cargo build", "cargo check",
  "npm run build", "pnpm build", "pnpm run build", "yarn build",
  "make", "cmake",
  "go build", "go install",
  "gradle", "mvn",
  "python setup.py build",
  "bun build",
];

for (const cmd of BUILD_COMMANDS) {
  registerFilter(cmd, filterBuild, "medium");
}
