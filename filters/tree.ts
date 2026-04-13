/**
 * tree output filter.
 *
 * Strips noise directories (node_modules, .git, __pycache__, .venv, etc.)
 * and their children. Caps at 80 lines.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const NOISE_DIRS = new Set([
  "node_modules", ".git", "target", "__pycache__",
  ".next", "dist", "vendor", "build",
  ".venv", "venv", ".cache", ".ruff_cache",
  ".pytest_cache", ".mypy_cache", ".tox",
  "zig-out", "zig-cache",
]);

function filterTree(input: string): FilterResult | null {
  if (input.length === 0) return null;

  const lines = input.split("\n");
  if (lines.length <= 20) return null; // Small tree, keep as-is

  const out: string[] = [];
  let stripped = 0;
  let inNoiseDir = false;
  let noiseDepth = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    if (out.length >= 80) {
      stripped++;
      continue;
    }

    const name = extractTreeName(line);
    const depth = countTreeDepth(line);

    // If inside a noise directory subtree, skip children
    if (inNoiseDir && depth > noiseDepth) {
      stripped++;
      continue;
    }
    if (inNoiseDir && depth <= noiseDepth) {
      inNoiseDir = false;
    }

    if (NOISE_DIRS.has(name)) {
      inNoiseDir = true;
      noiseDepth = depth;
      out.push(`${line} [stripped]`);
      continue;
    }

    out.push(line);
  }

  if (stripped > 0) out.push(`[${stripped} lines stripped]`);

  const result = out.join("\n");
  return result.length < input.length ? { output: result, category: "fast" } : null;
}

function extractTreeName(line: string): string {
  // Skip tree-drawing chars (├ └ │ ─ etc.) and whitespace
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 0x20 || c === 0x09 || c === 0x7C) { // space, tab, |
      i++;
    } else if (c === 0x2500 || c === 0x2502 || c === 0x2514 || c === 0x251C || c === 0x2524) {
      // Box-drawing: ─ │ └ ├ ┤
      i++;
    } else if (c === 0x2D) { // -
      i++;
    } else {
      break;
    }
  }
  // Handle UTF-8 box-drawing (3-byte sequences starting with 0xE2)
  // These show up when charCodeAt returns the raw byte values
  const rest = line.slice(i).replace(/^[─│└├┤┬┐┘┌╠╚╗═\s\-]+/, "");
  return rest.trim();
}

function countTreeDepth(line: string): number {
  // Approximate depth by leading whitespace/tree chars (4 chars per level typical)
  let spaces = 0;
  for (const ch of line) {
    if (ch === " " || ch === "│" || ch === "─" || ch === "├" || ch === "└" || ch === "┤" || ch === "|" || ch === "-") {
      spaces++;
    } else {
      break;
    }
  }
  return Math.floor(spaces / 3);
}

registerFilter("tree", filterTree, "fast");
