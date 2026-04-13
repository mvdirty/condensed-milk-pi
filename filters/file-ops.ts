/**
 * File operation filters: ls, find, grep/rg.
 *
 * ls: >10 files → count by extension + directory list
 * find: deduplicate path prefixes, count by directory
 * grep/rg: group by file, limit matches per file
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

// ─── ls ────────────────────────────────────────────────────────────────

function filterLs(input: string): FilterResult | null {
  if (input.length === 0) return { output: "ls: empty", category: "fast" };

  const dirs: string[] = [];
  const files: string[] = [];
  const extCounts = new Map<string, number>();

  for (const line of input.split("\n")) {
    if (line.length === 0 || line.startsWith("total ")) continue;
    const name = extractLsName(line);
    if (!name || name === "." || name === "..") continue;
    if (isNoise(name)) continue;

    if (line[0] === "d") {
      dirs.push(name);
    } else {
      files.push(name);
      const ext = getExtension(name);
      extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
    }
  }

  // Short listings: keep verbose
  if (files.length <= 20) return null;

  // Summary header
  const parts: string[] = [];
  if (dirs.length > 0) {
    const dirList = dirs.slice(0, 5).join(", ");
    parts.push(`dirs: ${dirList}${dirs.length > 5 ? ` +${dirs.length - 5} more` : ""}`);
  }

  const sorted = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);
  const extParts = sorted.slice(0, 6).map(([ext, count]) => `${count} ${ext}`);
  if (sorted.length > 6) extParts.push(`+${sorted.length - 6} more types`);
  parts.push(`${files.length} files: ${extParts.join(", ")}`);

  // Append first 10 raw filenames so the model can act immediately
  const firstFiles = files.slice(0, 10);
  parts.push("", ...firstFiles);
  if (files.length > 10) parts.push(`... +${files.length - 10} more`);

  return { output: parts.join("\n"), category: "fast" };
}

function extractLsName(line: string): string | null {
  // ls -la format: permissions links owner group size date date date name
  // Simple: grab the last whitespace-separated field
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  // Non-long format: entire line is the filename
  if (!trimmed.startsWith("-") && !trimmed.startsWith("d") && !trimmed.startsWith("l")) {
    return trimmed;
  }

  // Long format: find name after the date fields
  // Look for the pattern: "Mon DD HH:MM" or "Mon DD YYYY" then take the rest
  const datePattern = /\w{3}\s+\d{1,2}\s+[\d:]{4,5}\s+/;
  const match = datePattern.exec(trimmed);
  if (match) {
    const nameStart = match.index + match[0].length;
    const name = trimmed.slice(nameStart);
    // Handle symlinks: "name -> target"
    const arrow = name.indexOf(" -> ");
    return arrow >= 0 ? name.slice(0, arrow) : name;
  }

  // Fallback: last field
  const lastSpace = trimmed.lastIndexOf(" ");
  return lastSpace >= 0 ? trimmed.slice(lastSpace + 1) : trimmed;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "(no ext)";
  return name.slice(dot);
}

function isNoise(name: string): boolean {
  return name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini";
}

// ─── find ──────────────────────────────────────────────────────────────

function filterFind(input: string): FilterResult | null {
  if (input.length === 0) return null;

  const lines = input.split("\n").filter((l) => l.length > 0);
  if (lines.length <= 30) return null; // Small enough to keep

  // Count by directory prefix (first two path components)
  const dirCounts = new Map<string, number>();
  const extCounts = new Map<string, number>();

  for (const line of lines) {
    const dir = getDirectoryPrefix(line);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    const ext = getExtension(line.split("/").pop() ?? line);
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }

  const sortedDirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedExts = [...extCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Summary header
  const parts: string[] = [`${lines.length} results`];

  const dirParts = sortedDirs.slice(0, 5).map(([dir, n]) => `${dir} (${n})`);
  parts.push(`by dir: ${dirParts.join(", ")}`);

  const extParts = sortedExts.slice(0, 5).map(([ext, n]) => `${n} ${ext}`);
  parts.push(`by type: ${extParts.join(", ")}`);

  // Append first 15 raw paths so the model can act immediately
  parts.push("");
  const firstPaths = lines.slice(0, 15);
  parts.push(...firstPaths);
  if (lines.length > 15) parts.push(`... +${lines.length - 15} more (narrow your query)`);

  return { output: parts.join("\n"), category: "fast" };
}

function getDirectoryPrefix(path: string): string {
  const clean = path.startsWith("./") ? path.slice(2) : path;
  const parts = clean.split("/");
  return parts.length > 1 ? parts.slice(0, 2).join("/") : parts[0];
}

// ─── grep / rg ─────────────────────────────────────────────────────────

function filterGrep(input: string): FilterResult | null {
  if (input.length === 0) return null;

  const lines = input.split("\n").filter((l) => l.length > 0);
  if (lines.length <= 30) return null;

  // Group by file
  const byFile = new Map<string, number>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon > 0) {
      const file = line.slice(0, colon);
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
    }
  }

  if (byFile.size === 0) return null;

  const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  const parts: string[] = [`${lines.length} matches in ${byFile.size} files`];

  const fileSummaries = sorted.slice(0, 10).map(([file, count]) => `  ${file}: ${count} matches`);
  parts.push(...fileSummaries);
  if (sorted.length > 10) parts.push(`  +${sorted.length - 10} more files`);

  // Append first 10 raw match lines so the model can act immediately
  parts.push("");
  const firstMatches = lines.slice(0, 10).map((line) => `  ${line}`);
  parts.push(...firstMatches);
  if (lines.length > 10) parts.push(`  ... +${lines.length - 10} more (narrow your query)`);

  return { output: parts.join("\n"), category: "fast" };
}

// Register
registerFilter("ls", filterLs, "fast");
registerFilter("find", filterFind, "fast");
registerFilter("grep", filterGrep, "fast");
registerFilter("rg", filterGrep, "fast");
