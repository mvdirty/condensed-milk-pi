/**
 * Git mutation command filters: add, commit, push.
 *
 * These run 5-20x per session and produce verbose output the model never needs.
 * Zero risk — compressed output preserves success/failure + hash/branch.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

function filterGitAdd(input: string): FilterResult | null {
  const lines = input.split("\n").filter((l) => l.length > 0);
  return { output: `ok (${lines.length} files staged)`, category: "mutation" };
}

function filterGitCommit(input: string): FilterResult | null {
  if (input.includes("nothing to commit")) {
    return { output: "ok (nothing to commit)", category: "mutation" };
  }
  // Extract hash from "[branch hash] message" format
  const match = input.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
  if (match) {
    return { output: `ok ${match[1]}`, category: "mutation" };
  }
  return { output: "ok", category: "mutation" };
}

function filterGitPush(input: string): FilterResult | null {
  if (input.includes("up-to-date")) {
    return { output: "ok (up-to-date)", category: "mutation" };
  }
  // Find the "abc..def branch -> branch" line
  for (const line of input.split("\n")) {
    if (line.includes("->")) {
      return { output: `ok ${line.trim()}`, category: "mutation" };
    }
  }
  return { output: "ok", category: "mutation" };
}

registerFilter("git add", filterGitAdd, "mutation");
registerFilter("git commit", filterGitCommit, "mutation");
registerFilter("git push", filterGitPush, "mutation");
