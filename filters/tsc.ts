/**
 * TypeScript compiler (tsc) output filter.
 *
 * Clean output → "tsc: ok"
 * Errors → group by file, count + first 3 samples per file.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

interface FileErrors {
  file: string;
  count: number;
  samples: string[];
}

function filterTsc(input: string): FilterResult | null {
  if (input.length === 0) return { output: "tsc: ok", category: "fast" };

  // No errors
  if (!input.includes("error TS") && !input.includes("error ts")) {
    return { output: "tsc: ok", category: "fast" };
  }

  const files = new Map<string, FileErrors>();
  let totalErrors = 0;

  for (const line of input.split("\n")) {
    // tsc error format: "src/foo.ts(12,5): error TS2345: ..."
    const match = line.match(/^([^(]+)\(\d+,\d+\):\s*error\s+TS\d+/);
    if (!match) continue;

    const file = match[1];
    totalErrors++;

    let entry = files.get(file);
    if (!entry) {
      entry = { file, count: 0, samples: [] };
      files.set(file, entry);
    }
    entry.count++;
    if (entry.samples.length < 3) entry.samples.push(line.trim());
  }

  if (files.size === 0) return { output: "tsc: ok", category: "fast" };

  const out: string[] = [`tsc: ${totalErrors} errors in ${files.size} files`];
  const sorted = [...files.values()].sort((a, b) => b.count - a.count);
  const fileSummaries = sorted.slice(0, 10).map((e) => {
    const samples = e.samples.map((s) => `    ${s}`).join("\n");
    return `  ${e.file}: ${e.count} errors\n${samples}`;
  });
  out.push(...fileSummaries);
  if (sorted.length > 10) out.push(`  +${sorted.length - 10} more files`);

  return { output: out.join("\n"), category: "fast" };
}

registerFilter("tsc", filterTsc, "fast");
registerFilter("npx tsc", filterTsc, "fast");
