/**
 * Python script output filter — traceback compressor.
 *
 * When a Python script crashes, the output contains stdout THEN traceback.
 * This filter:
 * - If traceback present: drop stdout, keep first 2 + last 2 frames + exception
 * - If no traceback: passthrough (don't touch normal script output)
 *
 * Registered for "python" and "python3" commands, but only activates
 * when a traceback is detected.
 */
import { registerFilter, type FilterResult } from "./dispatch.js";

const TB_MARKER = "Traceback (most recent call last):";

function filterPythonOutput(input: string): FilterResult | null {
  if (input.length === 0) return null;

  const tbStart = input.indexOf(TB_MARKER);
  if (tbStart < 0) return null; // No traceback — passthrough

  // Extract traceback section
  const tbSection = input.slice(tbStart);
  const lines = tbSection.split("\n");

  // Parse frames: pairs of "  File ..." + "    code line"
  const frames: string[] = [];
  let exceptionLine = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("  File ")) {
      // Frame: "  File ..." + code line + optional pointer line (Python 3.13+)
      const frameParts = [line];
      // Collect indented continuation lines (code + ~^^ pointer)
      while (i + 1 < lines.length && lines[i + 1].startsWith("    ")) {
        i++;
        frameParts.push(lines[i]);
      }
      frames.push(frameParts.join("\n"));
    } else if (i > 0 && !line.startsWith(" ") && line.includes(":") && line.length > 0) {
      // Exception line: "ValueError: something"
      exceptionLine = line;
    }
  }

  if (frames.length === 0) return null;

  // Build compressed traceback: first 2 + last 2 frames + exception
  const out: string[] = [TB_MARKER];

  if (frames.length <= 4) {
    out.push(...frames);
  } else {
    out.push(...frames.slice(0, 2));
    out.push(`  ... ${frames.length - 4} frames omitted ...`);
    out.push(...frames.slice(-2));
  }

  if (exceptionLine) out.push(exceptionLine);

  // If there was stdout before the traceback, note it
  if (tbStart > 20) {
    const stdoutLines = input.slice(0, tbStart).split("\n").filter((l) => l.length > 0);
    if (stdoutLines.length > 0) {
      out.unshift(`[${stdoutLines.length} lines stdout before crash]`);
    }
  }

  return { output: out.join("\n"), category: "fast" };
}

// Register for python commands — only activates when traceback detected
registerFilter("python", filterPythonOutput, "fast");
registerFilter("python3", filterPythonOutput, "fast");
