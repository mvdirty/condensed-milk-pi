/**
 * Search/grep result grouping filter.
 * Groups grep/rg output by file with match counts.
 * Truncates individual match lines to 70 chars.
 *
 * Adapted from MasuRii/pi-rtk-optimizer techniques/search.ts
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

interface SearchResult {
  file: string;
  lineNumber: string;
  content: string;
}

const MIN_RESULTS_TO_GROUP = 15;
const MAX_MATCHES_PER_FILE = 10;
const MAX_TOTAL_SHOWN = 50;
const MAX_LINE_LENGTH = 70;

function compactPath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return `...${path.slice(-(maxLen - 3))}`;
  return `.../${parts.slice(-2).join("/")}`.slice(-maxLen);
}

function filterGrep(stdout: string, _command: string): FilterResult | null {
  const results: SearchResult[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // file:linenum:content
    const match = line.match(/^(.+?):(\d+):(.+)$/);
    if (!match) continue;
    results.push({
      file: match[1] ?? "unknown",
      lineNumber: match[2] ?? "?",
      content: match[3] ?? "",
    });
  }

  if (results.length < MIN_RESULTS_TO_GROUP) return null;

  const byFile = new Map<string, SearchResult[]>();
  for (const r of results) {
    const existing = byFile.get(r.file) ?? [];
    existing.push(r);
    byFile.set(r.file, existing);
  }

  const lines = [`${results.length} matches in ${byFile.size} files:`, ""];
  const sortedFiles = [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let shown = 0;
  for (const [file, matches] of sortedFiles) {
    if (shown >= MAX_TOTAL_SHOWN) break;
    lines.push(`> ${compactPath(file, 50)} (${matches.length} matches):`);
    for (const m of matches.slice(0, MAX_MATCHES_PER_FILE)) {
      let cleaned = m.content.trim();
      if (cleaned.length > MAX_LINE_LENGTH) cleaned = `${cleaned.slice(0, MAX_LINE_LENGTH - 3)}...`;
      lines.push(`    ${m.lineNumber}: ${cleaned}`);
      shown++;
    }
    if (matches.length > MAX_MATCHES_PER_FILE) {
      lines.push(`  +${matches.length - MAX_MATCHES_PER_FILE} more`);
    }
    lines.push("");
  }

  if (results.length > shown) {
    lines.push(`... +${results.length - shown} more matches`);
  }

  return { output: lines.join("\n"), category: "fast" };
}

// Register for grep/rg command prefixes
const GREP_COMMANDS = [
  "grep", "grep -rn", "grep -rni", "grep -n",
  "rg", "ripgrep",
];

for (const cmd of GREP_COMMANDS) {
  registerFilter(cmd, filterGrep, "fast");
}
