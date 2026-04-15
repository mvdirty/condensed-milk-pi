/**
 * Package install output filter.
 * Strips dependency resolution, download progress, deprecation warnings.
 * Keeps: final summary + actual errors.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const SKIP_PATTERNS: readonly RegExp[] = [
  /^\s*Resolving\s+/,
  /^\s*Downloading\s+/,
  /^\s*Progress:\s+/,
  /^\s*Fetching\s+/,
  /^\s*Linking\s+/,
  /^\s*Building\s+/,
  /^\s*Preparing\s+/,
  /^\s*Reusing\s+/,
  /^\s*npm\s+(warn|notice)\s+deprecated\s+/i,
  /^\s*npm\s+notice\s+/i,
  /^\s*\d+\s+packages?\s+are\s+looking\s+for\s+funding/i,
  /^\s*run\s+`npm\s+fund`/i,
  /^\s*Already\s+up\s+to\s+date/i,
  /^\s*\.\s*$/,
  /^\s*$/,
];

const SUMMARY_PATTERNS: readonly RegExp[] = [
  /added\s+\d+\s+packages?/i,
  /removed\s+\d+\s+packages?/i,
  /changed\s+\d+\s+packages?/i,
  /up\s+to\s+date/i,
  /\d+\s+packages?\s+installed/i,
  /Done\s+in\s+[\d.]+s/i,
  /Lockfile\s+is\s+up\s+to\s+date/i,
];

const ERROR_PATTERNS: readonly RegExp[] = [
  /^npm\s+ERR!/i,
  /^ERR_PNPM_/,
  /^error\b/i,
  /ERESOLVE\b/,
  /Could\s+not\s+resolve/i,
];

function filterInstall(stdout: string, _command: string): FilterResult | null {
  const lines = stdout.split("\n");
  if (lines.length < 10) return null;

  let skipped = 0;
  const summaries: string[] = [];
  const errors: string[] = [];
  let deprecationCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { skipped++; continue; }

    if (SUMMARY_PATTERNS.some((p) => p.test(trimmed))) {
      summaries.push(trimmed);
      continue;
    }

    if (ERROR_PATTERNS.some((p) => p.test(trimmed))) {
      errors.push(trimmed);
      continue;
    }

    if (/deprecated/i.test(trimmed)) {
      deprecationCount++;
      skipped++;
      continue;
    }

    if (SKIP_PATTERNS.some((p) => p.test(line))) {
      skipped++;
      continue;
    }
  }

  if (skipped < 5) return null;

  const result: string[] = [];

  if (errors.length > 0) {
    result.push(`Install FAILED (${errors.length} errors):`);
    result.push(...errors.slice(0, 10));
    if (errors.length > 10) result.push(`... +${errors.length - 10} more errors`);
  }

  if (summaries.length > 0) {
    result.push(...summaries);
  } else if (errors.length === 0) {
    result.push("[OK] Install completed");
  }

  if (deprecationCount > 0) result.push(`(${deprecationCount} deprecation warnings stripped)`);
  result.push(`(${skipped} noise lines stripped)`);

  return { output: result.join("\n"), category: "mutation" };
}

const INSTALL_COMMANDS = [
  "npm install", "npm i", "npm ci",
  "pnpm install", "pnpm i", "pnpm add",
  "yarn install", "yarn add", "yarn",
  "bun install", "bun add",
  "pip install", "pip3 install",
  "pip install -r", "pip3 install -r",
];

for (const cmd of INSTALL_COMMANDS) {
  registerFilter(cmd, filterInstall, "mutation");
}
