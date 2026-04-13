/**
 * JSON schema extraction filter.
 *
 * When bash output is large JSON (>1KB), extracts top-level structure
 * showing keys + types + array lengths instead of full values.
 * Model can re-read if it needs actual values.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const MIN_JSON_SIZE = 1024;

function filterJsonOutput(input: string): FilterResult | null {
  const trimmed = input.trim();
  if (trimmed.length < MIN_JSON_SIZE) return null;
  if (trimmed[0] !== "{" && trimmed[0] !== "[") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const schema = extractSchema(parsed, 0, 3);
  const header = Array.isArray(parsed)
    ? `JSON array [${(parsed as unknown[]).length} items]`
    : `JSON object`;

  const result = `${header}\n${schema}`;
  return result.length < input.length ? { output: result, category: "fast" } : null;
}

function extractSchema(value: unknown, depth: number, maxDepth: number): string {
  const indent = "  ".repeat(depth);

  if (value === null) return `${indent}null`;
  if (typeof value === "string") return `${indent}"string" (${value.length} chars)`;
  if (typeof value === "number") return `${indent}${value}`;
  if (typeof value === "boolean") return `${indent}${value}`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}[]`;
    if (depth >= maxDepth) return `${indent}[...${value.length} items]`;
    const first = extractSchema(value[0], depth + 1, maxDepth);
    return `${indent}[${value.length} items] first:\n${first}`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${indent}{}`;
    if (depth >= maxDepth) return `${indent}{...${entries.length} keys}`;

    const lines = entries.slice(0, 20).map(([key, val]) => {
      return `${indent}  "${key}": ${describeType(val)}`;
    });
    if (entries.length > 20) lines.push(`${indent}  ...+${entries.length - 20} more keys`);
    return `${indent}{\n${lines.join("\n")}\n${indent}}`;
  }

  return `${indent}${typeof value}`;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `string (${value.length})`;
  if (typeof value === "number") return `${value}`;
  if (typeof value === "boolean") return `${value}`;
  if (Array.isArray(value)) return `array [${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `object {${keys.slice(0, 5).join(", ")}${keys.length > 5 ? `, +${keys.length - 5}` : ""}}`;
  }
  return typeof value;
}

// Exported for use as a content-based fallback in dispatch
export { filterJsonOutput };
