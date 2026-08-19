# Failure Recovery (`PostToolUseFailure`)

Two hooks that fire when a `Bash` call running `mix` **fails**. Both inject
guidance through `hookSpecificOutput.additionalContext`, which is the channel
`PostToolUseFailure` supports.

They are deliberately layered: one gives generic per-command hints on the first
failure, the other watches for the *same command failing repeatedly* and
escalates.

| Script | Fires | Purpose |
|---|---|---|
| `elixir-failure-hints.sh` | every `mix` failure | Command-specific debugging hints |
| `error-critic.sh` | 2nd failure onward | Detects debugging loops, consolidates error history |

Both are registered with `"if": "Bash(*mix*)"`, so a failing `npm test` or
`curl` never spawns them.

---

## `elixir-failure-hints.sh`

Matches the failing command and injects a short checklist. Four branches:

**`mix compile`**

```text
- Read the FIRST error — later errors are often cascading
- Check for missing module aliases or imports
- If struct error: ensure the struct's module compiles first
- If protocol not implemented: check if you need @derive
- Scope fix to files YOU changed — pre-existing warnings are not your problem
```

**`mix test`**

```text
- Read the assertion error carefully — expected vs got
- Check test setup (setup/setup_all blocks) for stale data
- For async test failures: check for shared database state
- For LiveView test failures: ensure render returns before assertions
- Run the single failing test first: mix test path/to/test.exs:LINE
```

**`mix credo`** — priority ordering, module attribute placement, pipe chains.

**`mix ecto`** — existing table/column, `down/0` symmetry, constraint violations
against existing data.

Matching accepts a leading `MIX_ENV=` assignment, so `MIX_ENV=test mix test` is
recognized.

---

## `error-critic.sh`

Implements the Critic→Refiner architecture from AutoHarness (Lou et al., 2026).
The finding behind it: structured error consolidation before a retry prevents
debugging loops far better than unstructured retry does.

### How it tracks

State lives in `/tmp/.claude-elixir-failures/`, keyed by the mix subcommand:

```text
/tmp/.claude-elixir-failures/
├── _mix_test_.count   # failure counter
└── _mix_test_.log     # last 5 failures, trimmed to 100 lines
```

Each failure appends a timestamped block with the command and the first 20 lines
of error output.

### Escalation ladder

| Attempt | Behavior |
|---|---|
| 1 | **Silent.** Defers to `elixir-failure-hints.sh` so the two do not stack |
| 2 | Pattern warning — "same command failed before", asks whether the error is *identical* (fix missed the root cause) or *different* (progress, new issue) |
| 3+ | Full critic analysis with consolidated error history |

The 3rd-failure output:

```text
DEBUGGING LOOP DETECTED (attempt #3): mix test has failed 3 times.

CRITIC ANALYSIS — Consolidated error history:
[last 30 lines of accumulated failure log]

STRUCTURED RECOVERY (do NOT retry the same approach):
1. STOP retrying the same fix — it has failed 3 times
2. Read the FULL error output from attempt #1 (root cause is usually there)
3. Check if errors are IDENTICAL (same root cause) or DIFFERENT (cascading)
4. If identical: your mental model of the code is wrong. Re-read the source file
5. If cascading: fix the FIRST error only, ignore downstream errors
6. Consider: /phx:investigate for structured root-cause analysis
7. Consider: grep .claude/solutions/ for previously solved similar errors
```

The instruction to re-read attempt #1's output is the point of the whole hook.
By attempt 3, the transcript is dominated by cascading downstream noise, and the
signal is in the first failure — which has usually scrolled well out of
attention.

### Counter lifetime

The counters live in `/tmp` and are **not** cleared on success. A command that
fails, gets fixed, and later fails again for an unrelated reason resumes from
the old count, so the critic can fire earlier than the raw retry count suggests.
`/tmp` clears on reboot.

### Manual fallback

The hook only covers `mix`. For non-`mix` loops, `CLAUDE.md` carries the manual
rule: when 3+ consecutive Bash calls are compile/test failures, offer
`/phx:investigate`.

## Related

- [Code Quality](code-quality.md) — the `PostToolUse` checks on successful edits
- `/phx:investigate` — structured root-cause analysis, the escape hatch both hooks point at
- `investigation-ledger` skill — for bug hunts long enough to survive compaction
