# Bot Review Triage

CI bots (Copilot, Codex, CodeRabbit, SonarCloud) post review passes as
inline review threads + a review summary. They produce volume — triage in
batch, but never bulk-resolve without replies (SKILL.md Iron Laws 6 + 9).

## Known bot logins

`copilot-*`, `codex`, `coderabbitai`, `sonarcloud`, `github-actions`,
`dependabot`, `*-ci`. Detect via `__typename == "Bot"` (GraphQL) or
`user.type == "Bot"` (REST) — see `gh-commands.md` for why the `[bot]`
login suffix is unreliable.

## Batch flow (`--bots-only`)

1. Fetch unresolved threads, filter `isBot == true`
2. Classify each finding:

| Verdict | Signal | Action |
|---------|--------|--------|
| **Real bug** | Reproducible, matches code behavior | Fix → reply with diff summary → resolve |
| **Real but deferred** | Valid, out of this PR's scope | Reply "tracked as follow-up: {ref}" → resolve |
| **False positive** | Bot misread the code | Reply with one-line explanation of why it's safe → resolve |
| **Iron Law conflict** | Bot suggests an Iron Law violation | Reply declining with the law + reasoning → resolve |

3. Present the verdict table to the user BEFORE posting anything
4. Post replies + resolve only after approval

## Common false-positive patterns (Elixir)

- **`nil[:key]` flagged as crash risk** — Access protocol on nil returns
  nil; nil-safe by design. Reply: "Access lookup on nil is nil-safe in
  Elixir (`nil[:key]` → `nil`); no guard needed."
- **"Unused variable" on pattern-match bindings** — bindings used for
  match assertion, not value. Prefix with `_` only if truly unused.
- **"Missing error handling" on `!` functions** — `Repo.get!`/`File.read!`
  crash intentionally per let-it-crash; supervised recovery is the design.
- **Atom-vs-string key confusion in test fixtures** — bots often suggest
  atomizing external/JSON data; that violates Iron Law #10 territory
  (`String.to_atom` on input). Decline.

## What NOT to do

- Never auto-resolve a bot pass to "clean up the PR" — each thread gets a
  reply first, even one line.
- Never accept a bot's code suggestion verbatim without reading the
  surrounding code — bots see the diff hunk, not the module.
- Never let a bot summary (review body) block on "resolution" — summaries
  are not threads and cannot be resolved; address inline findings instead.
