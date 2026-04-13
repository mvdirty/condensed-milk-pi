# 🥛 Condensed Milk

**Semantic token compression for [pi terminal](https://github.com/badlogic/pi-mono).** Cuts LLM token consumption by compressing bash tool output and retroactively shrinking stale conversation history.

Inspired by [ztk](https://github.com/codejunkie99/ztk) (Zig) and [RTK](https://github.com/rtk-ai/rtk) (Rust) — standalone CLI proxies for Claude Code — rebuilt as a native pi extension using `tool_result` post-processing and pi's `context` event. This architecture gives Condensed Milk capabilities that standalone proxies structurally cannot have.

## What It Does

### Tool Result Compression

Intercepts bash command output before the model sees it and applies semantic compression — not blind truncation but domain-aware filters that preserve meaning while dropping noise.

| Command | Before | After | Savings |
|---------|--------|-------|---------|
| `python -m pytest` | 50+ lines of progress dots, headers, timing | `pytest: 125 passed, 15 skipped in 5.6s` | ~95% |
| `git status` | Branch info, staging area, working tree | `on main: 3 staged, 2 modified [file1, file2]` | ~75% |
| `git diff` (large) | Full patch with metadata headers | Changed lines only, context collapsed | ~70% |
| `git log` (verbose) | Author/Date/body per commit | `hash subject` per commit | ~80% |
| `git add/commit/push` | Transfer progress, CRLF warnings | `ok abc1234` | ~90% |
| `ls -la` (>20 files) | Permission bits, dates, owners | Extension counts + first 10 names | ~80% |
| `find` (>30 results) | Full path listing | Dir/type summary + first 15 paths | ~70% |
| `grep/rg` (>30 matches) | All matches | File summary + first 10 matches | ~65% |
| `tree` | Full tree with noise dirs | Stripped `.git/node_modules/.venv/__pycache__` | ~50-90% |
| `env` | All variables, secrets in plain text | Secrets masked, values truncated | ~60% + security |
| Python traceback | Full stack trace | First 2 + last 2 frames + exception | ~50% |
| `tsc` | Verbose TS errors | Grouped by file, 3 samples each | ~60% |
| Log output | Repeated lines with timestamps | Collapsed to `line [xN]` | Variable |
| JSON output (>1KB) | Full values, deeply nested | Keys + types + array lengths | ~80% |

**Log dedup normalization** (from RTK): UUIDs, hex addresses, and large numbers are normalized before dedup matching, so lines differing only in request IDs or memory addresses collapse together.

### Context Retroactive Compression

The killer feature that standalone proxies **cannot** do.

Pi's `context` event fires before every LLM call with a deep copy of the conversation history. Condensed Milk retroactively compresses old tool results that the model already processed but are still consuming context:

**Bash results** older than 8 turns → compressed via filter dispatch or line-count fallback.

**Read (file) results** use smart staleness:
- **Kept fresh** if the file was written/edited after being read (model is actively working on it)
- **Kept fresh** if it's a reference file (AGENTS.md, CONVENTIONS.md, configs, package.json, etc.)
- **Compressed** if >8 turns old and never subsequently written
- **Compressed** if a newer read of the same file exists (older duplicate superseded)
- Compressed reads preserve the file path + first 3 lines (imports/header)

In practice, this saves **hundreds of KB per session** from stale file reads and old command outputs — effectively doubling context runway before compaction.

### Compound Command Handling

Real-world commands are chains:

```bash
source .venv/bin/activate && python -m pytest -q 2>&1 | tail -3 && ruff check src/
```

The dispatcher splits on `&&`/`||`/`;`, strips pipe tails (`| head`, `| tail`, `| wc`), cleans env vars and redirects, then matches each segment against registered filters. Last matching segment wins (it produced the output).

### Secret Masking

The `env`/`printenv` filter masks values for keys containing `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `API`, `AUTH`, or `CREDENTIAL`. This prevents API keys and secrets from entering the LLM context window.

## Install

Copy to your pi global extensions directory:

```bash
git clone https://github.com/tomooshi/condensed-milk-pi.git
cp -r condensed-milk-pi ~/.pi/agent/extensions/condensed-milk
```

Or symlink:

```bash
git clone https://github.com/tomooshi/condensed-milk-pi.git ~/condensed-milk-pi
ln -s ~/condensed-milk-pi ~/.pi/agent/extensions/condensed-milk
```

Then restart pi or run `/reload`.

## Usage

The extension works automatically — no configuration needed. Every bash command the model runs goes through the compression pipeline.

### Commands

| Command | Description |
|---------|-------------|
| `/compress-stats` | Show compression statistics for the current session |

### Status Bar

Shows a running total: `↓12.5KB saved (15/42 cmds, 68%)`

## Architecture

```
condensed-milk/
├── index.ts                    # Extension entry — tool_result + context hooks
├── filters/
│   ├── dispatch.ts             # Command matching + compound splitting
│   ├── pytest.ts               # pytest/python -m pytest
│   ├── git-status.ts           # git status (porcelain v1/v2/plain)
│   ├── git-diff.ts             # git diff (strip headers, condense context)
│   ├── git-mutations.ts        # git add/commit/push
│   ├── git-log.ts              # git log (verbose → hash subject)
│   ├── file-ops.ts             # ls, find, grep, rg
│   ├── tree.ts                 # tree (strip noise dirs)
│   ├── env.ts                  # env/printenv (mask secrets)
│   ├── python-traceback.ts     # Python crash output
│   ├── log-dedup.ts            # journalctl, tail, docker logs, tmux
│   ├── tsc.ts                  # TypeScript compiler
│   ├── json-schema.ts          # JSON structure extraction (content-based)
│   └── context-compress.ts     # Retroactive context compression
└── package.json
```

### How It Works

1. **`tool_result` hook** — runs after pi's built-in 50KB truncation, before the model sees the output. Matches the command against registered filters and returns compressed content.

2. **`context` event hook** — runs before each LLM API call. Walks the conversation history, identifies stale tool results (bash >8 turns, read with smart file-ops tracking), and replaces them with compressed summaries.

3. **Filter dispatch** — splits compound commands, strips pipes/redirects/env vars, and matches against registered filter prefixes. Longest prefix wins. Filters return `null` to decline (output passes through unchanged).

### Adding Filters

```typescript
import { registerFilter, type FilterResult } from "./dispatch.js";

function filterMyCommand(input: string): FilterResult | null {
  if (input.length === 0) return null;
  // Your compression logic here
  return { output: "compressed", category: "fast" };
}

registerFilter("my-command", filterMyCommand, "fast");
```

Categories: `"fast"` (ls, grep), `"medium"` (test runners), `"slow"` (git log), `"immutable"` (never changes), `"mutation"` (git add/commit/push).

## What's NOT Supported

These filters exist in [ztk](https://github.com/codejunkie99/ztk) but are intentionally not ported:

| Filter | Why not |
|--------|---------|
| `cat` / file content | **Harmful for coding agents.** The model needs full file content to write correct edits. Stripping function bodies breaks line numbers. |
| `cargo test/build` | Rust stack — add if you need it |
| `go test` | Go stack — add if you need it |
| `zig build/test` | Zig stack — add if you need it |
| `kubectl`, `docker` | Container orchestration — add if you need it |
| `gh` (GitHub CLI) | Low frequency |
| `curl` JSON schema | Too risky — model often needs actual values |
| `make`, `terraform`, `helm`, `gradle`, `mvn`, `dotnet`, etc. | 25 regex-based runtime filters for stacks we don't use. See ztk for patterns. |
| Session dedup (mmap) | Context retroactive compression handles this more effectively |

**Contributing stack-specific filters is welcome.** The dispatch system is designed for easy extension — register a prefix and a function.

## vs ztk and RTK

| | [ztk](https://github.com/codejunkie99/ztk) | [RTK](https://github.com/rtk-ai/rtk) | Condensed Milk |
|---|-----|-----|----------------|
| Language | Zig | Rust | TypeScript |
| Target | Claude Code | Claude Code | pi terminal |
| Architecture | Standalone binary, PreToolUse hook | Standalone binary, PreToolUse hook | Native extension, tool_result + context hooks |
| Context compression | ❌ | ❌ | ✅ Retroactively compresses stale results (**biggest savings**) |
| Read compression | ❌ | ✅ Language-aware file filtering | ✅ Smart file-ops-aware staleness (keeps files being edited) |
| Secret masking | ❌ | ❌ | ✅ env filter masks API keys/tokens/passwords |
| JSON structure | ❌ | ✅ Schema extraction | ✅ Content-based schema extraction |
| Session dedup | ✅ mmap shared memory | ❌ | Unnecessary (context compression subsumes it) |
| Code filtering | ✅ Strips function bodies | ✅ 3 filter levels (None/Minimal/Aggressive) | ❌ Intentionally — harmful for coding agents |
| TOML filter DSL | ❌ | ✅ 60+ declarative filters | ❌ All filters are code |
| Log normalization | Timestamps only | ✅ UUIDs, hex, numbers, paths | ✅ UUIDs, hex, numbers (from RTK) |
| Adaptive learning | ❌ | ✅ Mistake detection + suggestions | ❌ |
| Analytics | ❌ | ✅ Rich per-day/week/month + API cost | Basic session stats in status bar |
| Traceback compression | ❌ | ❌ (pytest only) | ✅ Generic Python traceback (first 2 + last 2 frames) |
| Performance | ⚡ Zig + SIMD | ⚡ Rust | Fast enough (TypeScript on <50KB post-truncation) |
| Stack coverage | Broad (Rust, Go, Zig, Docker, K8s) | Very broad (60+ TOML filters) | Python/TypeScript/Git focused |
| Install | Homebrew / zig build | Homebrew / cargo install | Copy to ~/.pi/agent/extensions/ |

### Where Condensed Milk wins

- **Context retroactive compression** — ztk and RTK are standalone proxies that only see output once. Condensed Milk compresses stale tool results in conversation history before each LLM call. This saved **1.4MB in a single session** — more than all tool-result filters combined.
- **Smart read staleness** — tracks file operations across the session. Keeps reads where the file was subsequently edited (model is working on it). Compresses old exploratory reads.
- **Python traceback compression** — generic crash output compression (first 2 + last 2 frames + exception). RTK only has pytest-specific filtering. Handles Python 3.13 pointer lines.
- **Secret masking** — prevents API keys from entering the LLM context sent to Anthropic.
- **Compound command dispatch** — handles `source && pytest | tail` chains that real coding sessions produce.

### Where RTK wins

- **Breadth** — 60+ TOML filters covering Rust, Go, .NET, Ruby, Docker, K8s, Terraform, Ansible, and more.
- **TOML DSL** — declarative filter definitions with `strip_lines_matching`, `match_output`, `max_lines`, and inline tests.
- **Adaptive learning** — watches for repeated CLI mistakes and suggests corrections.
- **Analytics** — rich per-day/week/month reporting with API cost integration.
- **File read filtering** — language-aware comment/import stripping (though we consider this harmful for coding agents).

## Measured Results

From a real coding session:

```
Token Compressor Stats
  Commands processed: 42
  Commands compressed: 15
  Original: 11.0KB → Compressed: 4.8KB (56% saved)
  Context retroactive: 1.4MB saved (8 compressions)
```

The context retroactive compression is the dominant savings — **1.4MB in one session** from compressing stale file reads and old command outputs.

## License

MIT
