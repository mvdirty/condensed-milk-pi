/**
 * Context-level retroactive compression.
 *
 * Compresses stale tool results (bash AND read) in conversation history
 * before each LLM call.
 *
 * Staleness for bash: >STALE_THRESHOLD turns old.
 * Staleness for read: smart — tracks file operations to determine if
 * a read is still relevant:
 *
 *   KEEP if: file was written/edited AFTER being read (model is working on it)
 *   KEEP if: file is in the reference set (AGENTS.md, CONVENTIONS.md, configs)
 *   KEEP if: file appears in an edit/write tool_call within recent turns
 *   COMPRESS if: >STALE_THRESHOLD turns old AND no subsequent write
 *   COMPRESS if: file was re-read more recently (compress the OLDER duplicate)
 */
import { dispatch } from "./dispatch.js";

const STALE_THRESHOLD = 8;
const MIN_COMPRESS_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 150;

/** Files that should never be compressed — reference docs, configs */
const REFERENCE_FILES = new Set([
  "AGENTS.md", "CONVENTIONS.md", "CLAUDE.md",
  ".ruff.toml", "ruff.toml", "biome.json",
  "pyproject.toml", "package.json", "tsconfig.json",
  "sgconfig.yml", ".shellcheckrc",
]);

function isReferenceFile(path: string): boolean {
  const basename = path.split("/").pop() ?? path;
  return REFERENCE_FILES.has(basename);
}

/**
 * Build a map of file operations from the message history.
 * Returns: { path → { lastReadTurn, lastWriteTurn, readTurns[] } }
 */
interface FileOps {
  lastReadTurn: number;
  lastWriteTurn: number;
  readTurns: number[]; // All turns where this file was read
}

function buildFileOpsMap(messages: any[]): Map<string, FileOps> {
  const ops = new Map<string, FileOps>();
  let turnIdx = 0;

  for (const m of messages) {
    // Count turns by user messages
    const msg = m?.message ?? m;
    if (msg?.role === "user") {
      turnIdx++;
      continue;
    }

    // Track tool calls for write/edit
    if (msg?.role === "assistant" && Array.isArray(msg?.content)) {
      for (const block of msg.content) {
        if (block?.type === "toolCall") {
          const name = block.name;
          if (name === "write" || name === "edit") {
            const path = block.arguments?.path ?? block.arguments?.file_path ?? "";
            if (path) {
              const entry = ops.get(path) ?? { lastReadTurn: -1, lastWriteTurn: -1, readTurns: [] };
              entry.lastWriteTurn = turnIdx;
              ops.set(path, entry);
            }
          }
        }
      }
    }

    // Track read tool results
    if (msg?.role === "toolResult" && msg?.toolName === "read") {
      const path = (msg as any)?.details?.path ?? "";
      if (path) {
        const entry = ops.get(path) ?? { lastReadTurn: -1, lastWriteTurn: -1, readTurns: [] };
        entry.lastReadTurn = turnIdx;
        entry.readTurns.push(turnIdx);
        ops.set(path, entry);
      }
    }
  }

  return ops;
}

/**
 * Determine if a read result should be compressed.
 */
function shouldCompressRead(
  path: string,
  readTurn: number,
  currentTurn: number,
  fileOps: Map<string, FileOps>,
): boolean {
  // Never compress reference files
  if (isReferenceFile(path)) return false;

  const ops = fileOps.get(path);
  if (!ops) return false;

  // Not old enough
  if (currentTurn - readTurn < STALE_THRESHOLD) return false;

  // File was written/edited AFTER this read — model is working on it, keep
  if (ops.lastWriteTurn > readTurn) return false;

  // This is NOT the most recent read of this file — compress (newer read supersedes)
  if (ops.lastReadTurn > readTurn) return true;

  // Old read, never subsequently written — compress
  return true;
}

/**
 * Process messages array from context event.
 * Returns modified array if any compressions were made, null otherwise.
 */
export function compressStaleToolResults(messages: any[]): any[] | null {
  if (messages.length === 0) return null;

  // Count total turns
  let totalTurns = 0;
  for (const m of messages) {
    const msg = m?.message ?? m;
    if (msg?.role === "user") totalTurns++;
  }

  // Not enough history for compression
  if (totalTurns < STALE_THRESHOLD) return null;

  // Build file operations map for smart read compression
  const fileOps = buildFileOpsMap(messages);

  // Find stale-before index for bash (same as before)
  let turnCount = 0;
  let staleBeforeIdx = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]?.message ?? messages[i];
    if (msg?.role === "user") {
      turnCount++;
      if (turnCount >= STALE_THRESHOLD) {
        staleBeforeIdx = i;
        break;
      }
    }
  }

  let modified = false;
  let currentTurn = 0;

  const result = messages.map((m: any, idx: number) => {
    const msg = m?.message ?? m;
    if (msg?.role === "user") currentTurn++;

    // === BASH COMPRESSION (same as before, turn-based) ===
    if (idx < staleBeforeIdx && isBashToolResult(msg) && !msg.isError) {
      const content = extractTextContent(msg);
      if (content.length >= MIN_COMPRESS_LENGTH && !content.startsWith("[compressed]")) {
        const command = msg.details?.command ?? (msg as any)?.input?.command ?? "";
        const summary = compressBashContent(command, content);
        modified = true;
        return replaceContent(m, `[compressed] ${summary}`);
      }
    }

    // === READ COMPRESSION (smart, file-ops-aware) ===
    if (isReadToolResult(msg) && !msg.isError) {
      const path = msg.details?.path ?? "";
      const content = extractTextContent(msg);

      if (path && content.length >= MIN_COMPRESS_LENGTH && !content.startsWith("[compressed]")) {
        if (shouldCompressRead(path, currentTurn, totalTurns, fileOps)) {
          const lineCount = content.split("\n").length;
          // Keep first 3 lines (imports/header) for context
          const preview = content.split("\n").slice(0, 3).join("\n");
          const summary = `read ${path} (${lineCount} lines)\n${preview}\n...`;
          modified = true;
          return replaceContent(m, `[compressed] ${summary}`);
        }
      }
    }

    return m;
  });

  return modified ? result : null;
}

function isBashToolResult(msg: any): boolean {
  return msg?.role === "toolResult" && msg?.toolName === "bash";
}

function isReadToolResult(msg: any): boolean {
  return msg?.role === "toolResult" && msg?.toolName === "read";
}

function extractTextContent(msg: any): string {
  return (msg.content ?? [])
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text ?? "")
    .join("\n");
}

function compressBashContent(command: string, content: string): string {
  const compressed = dispatch(command, content);
  if (compressed) return compressed.output;

  // Fallback: line count + first line preview
  const lines = content.split("\n").filter((l: string) => l.length > 0);
  const preview = lines[0]?.slice(0, 80) ?? "";
  let summary = `${lines.length} lines: ${preview}${lines.length > 1 ? ` ... +${lines.length - 1} more` : ""}`;
  if (summary.length > MAX_SUMMARY_LENGTH) summary = summary.slice(0, MAX_SUMMARY_LENGTH) + "...";
  return summary;
}

function replaceContent(m: any, text: string): any {
  if (m?.message) {
    return {
      ...m,
      message: { ...m.message, content: [{ type: "text", text }] },
    };
  }
  return { ...m, content: [{ type: "text", text }] };
}
