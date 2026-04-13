/**
 * Generic log line dedup filter.
 *
 * Collapses consecutive identical lines (modulo timestamps) to "line [xN]".
 * Catches journalctl, tail, docker logs, tmux capture-pane output.
 * Caps at 100 unique lines.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const TIMESTAMP_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*\s*/,
  /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s*/,
  /^\d{10,13}\s*/,
  /^\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*\]\s*/,
  /^\d{2}:\d{2}:\d{2}[.\d]*\s*/,
];

// Dynamic value patterns (from RTK) — normalize for better dedup matching
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /0x[0-9a-f]+/gi;
const LARGE_NUM_RE = /\b\d{4,}\b/g;

function normalize(line: string): string {
  let s = line;
  // Strip timestamps
  for (const p of TIMESTAMP_PATTERNS) {
    const match = p.exec(s);
    if (match) { s = s.slice(match[0].length); break; }
  }
  // Normalize dynamic values for matching (not for display)
  s = s.replace(UUID_RE, "<UUID>");
  s = s.replace(HEX_RE, "<HEX>");
  s = s.replace(LARGE_NUM_RE, "<NUM>");
  return s;
}

function filterLogOutput(input: string): FilterResult | null {
  if (input.length === 0) return null;

  const lines = input.split("\n");
  if (lines.length <= 15) return null;

  const out: string[] = [];
  let prevCanonical = "";
  let prevLine = "";
  let dupCount = 0;
  let emitted = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    if (emitted >= 100) break;

    const canonical = normalize(line);

    if (canonical === prevCanonical && canonical.length > 0) {
      dupCount++;
      prevLine = line;
      continue;
    }

    if (prevLine.length > 0) {
      out.push(dupCount > 0 ? `${prevLine}  [x${dupCount + 1}]` : prevLine);
      emitted++;
    }

    prevCanonical = canonical;
    prevLine = line;
    dupCount = 0;
  }

  if (prevLine.length > 0 && emitted < 100) {
    out.push(dupCount > 0 ? `${prevLine}  [x${dupCount + 1}]` : prevLine);
  }

  const result = out.join("\n");
  return result.length < input.length ? { output: result, category: "fast" } : null;
}

registerFilter("journalctl", filterLogOutput, "fast");
registerFilter("docker logs", filterLogOutput, "fast");
registerFilter("tail", filterLogOutput, "fast");
registerFilter("tmux capture-pane", filterLogOutput, "fast");
