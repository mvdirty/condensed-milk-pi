# Changelog

All notable changes to condensed-milk.

## [1.2.0] - 2026-04-16

### Fixed — cache-thrash bug in rolling-window masking (ADR-018)

The rolling-window algorithm introduced in v1.1.0 was measured to be
**actively harmful**: it produced 2x more distinct cache prefix variants
than no masking at all, costing 11% MORE than doing nothing.

Root cause: mask frontier at `messages.length - windowSize` shifts by 1
every turn a new tool result appends. Anything hashed up through BP2
(last-user-message cache breakpoint) that included that position must
be re-cached. Classic frontier-drift thrash.

### Changed — static-cutoff algorithm replaces rolling window

The cutoff T advances only when context usage crosses a pressure
threshold. Between advances, T is immutable — bytes before T stay
byte-identical turn-over-turn — cache prefix stays stable.

- Default thresholds: `[0.20, 0.35, 0.50]` of context window usage
- Default coverage:   `[0.50, 0.75, 0.90]` fraction of messages masked

T monotonically advances. Once a message is masked, it stays masked.

### Measured on a real 1114-turn session JSONL (test-replay.mjs)

| Algorithm | Cache variants | Write cost | Read cost | Total |
|---|---|---|---|---|
| No retroactive masking | 157 | $1386 | $28 | **$1414** |
| Rolling window N=10 (v1.1.1) | 316 | $1564 | $30 | **$1594** |
| Static cutoff (v1.2.0) | 159 | $1320 | $26 | **$1346** |

Static cutoff saves **16% vs rolling window** and **5% vs no masking**.

### Config changes

- `windowSize` replaced by `thresholds` + `coverage` arrays
- Old config files with `windowSize` silently ignored, defaults applied
- `/compress-config thresholds 0.20,0.35,0.50`
- `/compress-config coverage   0.50,0.75,0.90`

### Validation

- test-replay.mjs: offline harness that replays any pi session JSONL
  through both algorithms and reports cache-variant counts + cost.
- Proves directionally correct; live A/B should follow.

### Migration

Automatic. Existing `~/.config/condensed-milk.json` with
`{windowSize: 10}` will be silently overwritten with new defaults on
next config save. No user action needed.

### References

- ADR-018 (mojo-template-pi vault) — supersedes parts of ADR-016
- Measurement: `test-replay.mjs` committed to repo

## [1.1.1] - 2026-04-16

### Fixed

- `/compress-stats` output now correctly reports retroactive masking:
  total tool results masked, distinct mask events, bytes freed — instead
  of the stale `Context retroactive: X saved (N compressions)` line
  which conflated per-event counts with per-mask counts.
- Context-retroactive counters (`contextSaved`, `contextMaskEvents`,
  `contextMasksTotal`) now reset on `session_start` along with the
  other per-session state.
- Removed unused `tokensSaved` local variable.

## [1.1.0] - 2026-04-16

### Changed — retroactive compression switched from summarization to observation masking

The `context`-event compression path now uses **observation masking** with a
fixed rolling window instead of turn-distance summarization. This follows
JetBrains Research (Lindenbauer et al., Dec 2025) empirical finding that
masking outperforms LLM-style summarization on agent sessions, and
Anthropic's endorsement of "tool result clearing" as the safest lightest
form of compaction.

**Algorithm:**
- Fixed rolling window: last N messages (default 10) kept unmasked
- Older bash and read tool results replaced with deterministic placeholders:
  `[masked bash] <command>` and `[masked read] <path>`
- Reference files (AGENTS.md, CONVENTIONS.md, package.json, etc.) never masked
- Command-invalidation rules still honored (git add invalidates git status etc.)

**Why masking over summarization:**
- Byte-identical placeholders → single cache miss per tool-result lifetime,
  then stable forever. Summarization changed bytes every turn → repeated
  cache misses.
- JetBrains empirical: masking matches or beats summarization on solve
  rate, -52% cost on Qwen3-Coder 480B
- Summaries cause trajectory elongation (+13-15% more turns) by smoothing
  over stop-signals
- Simpler code, fewer edge cases, lower per-turn CPU
- Agent can re-fetch via `read` or re-run commands (just-in-time pattern
  per Anthropic)

**Measured on a real 1074-message session that previously produced 0
compressions:** 301 masks applied, ~420KB saved, ~105K tokens freed.

### Removed

- `STALE_THRESHOLD` turn-distance heuristic (replaced by rolling window)
- `buildFileOpsMap` / file-op tracking (masking is self-correcting)
- `cacheAware` config toggle + `cacheTtlMs` — was structurally broken
  (relied on missing `createdAt` field) and unnecessary under masking
- `JSON.stringify(messages).length` savings measurement — replaced with
  analytical sum computed during the pass (MB-per-turn overhead gone)

### Added

- `window-size` config key: `/compress-config window-size <N>`
- `masksApplied` field in per-turn telemetry
- Robust toolCallId → command/path lookup: works on both live in-memory
  context events (where `details` is populated) and persisted JSONL
  shapes (where `details` is dropped)

### Migration

Existing config files with `cacheAware` / `cacheTtlMs` will be silently
ignored and replaced on next save. Default behavior change: compression now
fires on every session with >10 messages. Previously it often produced 0
compressions on post-branch-summary sessions.

### References

- ADR-016 in the mojo-template-pi vault (full rationale)
- JetBrains: https://blog.jetbrains.com/research/2025/12/efficient-context-management/
- Anthropic: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Chroma Context Rot: https://research.trychroma.com/context-rot

## [1.0.0] - 2026-04-14

Initial release.
