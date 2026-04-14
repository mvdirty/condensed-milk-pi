/**
 * Linter output aggregation filter.
 * Compresses verbose eslint/ruff/mypy/pylint/flake8/clippy output into
 * a summary: error/warning counts, top rules, top files.
 *
 * Adapted from MasuRii/pi-rtk-optimizer techniques/linter.ts
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

interface Issue {
  severity: "ERROR" | "WARNING";
  rule: string;
  file: string;
  line?: number;
  message: string;
}

function detectLinterType(command: string): string {
  if (/eslint\b/.test(command)) return "ESLint";
  if (/ruff\b/.test(command)) return "Ruff";
  if (/pylint\b/.test(command)) return "Pylint";
  if (/mypy\b/.test(command)) return "MyPy";
  if (/flake8\b/.test(command)) return "Flake8";
  if (/clippy\b/.test(command)) return "Clippy";
  if (/golangci-lint\b/.test(command)) return "GolangCI-Lint";
  if (/prettier\b/.test(command)) return "Prettier";
  if (/black\b/.test(command)) return "Black";
  return "Linter";
}

function parseLine(line: string): Issue | null {
  // file:line:col: message [rule]
  const match = line.match(/^(.+?):(\d+):(?:\d+:)?\s*(.+)$/);
  if (!match) return null;

  const file = match[1] ?? "unknown";
  const lineNum = Number.parseInt(match[2] ?? "0", 10);
  const content = match[3] ?? line;
  const severity = /warning/i.test(content) ? "WARNING" : "ERROR";
  const rule = content.match(/\[(.+?)\]$/)?.[1] ?? content.match(/\((.+?)\)$/)?.[1] ?? "unknown";

  return {
    severity,
    rule,
    file,
    line: Number.isNaN(lineNum) ? undefined : lineNum,
    message: content,
  };
}

function compactPath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return `...${path.slice(-(maxLen - 3))}`;
  return `.../${parts.slice(-2).join("/")}`.slice(-maxLen);
}

function filterLinter(stdout: string, command: string): FilterResult | null {
  const linterType = detectLinterType(command);
  const issues: Issue[] = [];
  for (const line of stdout.split("\n")) {
    const parsed = parseLine(line);
    if (parsed) issues.push(parsed);
  }

  // Need enough issues to justify compression
  if (issues.length < 5) return null;

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;

  const byRule = new Map<string, number>();
  for (const i of issues) byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);

  const byFile = new Map<string, Issue[]>();
  for (const i of issues) {
    const existing = byFile.get(i.file) ?? [];
    existing.push(i);
    byFile.set(i.file, existing);
  }

  const lines = [`${linterType}: ${errors} errors, ${warnings} warnings in ${byFile.size} files`];

  lines.push("Rules:");
  const sortedRules = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [rule, count] of sortedRules) lines.push(`  ${rule} (${count}x)`);

  lines.push("Files:");
  const sortedFiles = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  for (const [file, fileIssues] of sortedFiles) {
    lines.push(`  ${compactPath(file, 40)} (${fileIssues.length} issues)`);
    const seen = new Set<string>();
    for (const issue of fileIssues) {
      if (seen.size >= 3) break;
      if (seen.has(issue.rule)) continue;
      seen.add(issue.rule);
      const msg = issue.message.length > 60 ? `${issue.message.slice(0, 57)}...` : issue.message;
      lines.push(`    L${issue.line ?? "?"}: ${msg}`);
    }
  }

  return { output: lines.join("\n"), category: "medium" };
}

// Register for all linter command prefixes
const LINTER_COMMANDS = [
  "eslint", "npx eslint", "pnpm eslint",
  "ruff", "ruff check",
  "pylint", "mypy", "flake8", "black",
  "prettier", "npx prettier",
  "cargo clippy",
  "golangci-lint",
];

for (const cmd of LINTER_COMMANDS) {
  registerFilter(cmd, filterLinter, "medium");
}
