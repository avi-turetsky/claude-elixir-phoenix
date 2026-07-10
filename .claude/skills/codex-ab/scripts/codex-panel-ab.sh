#!/usr/bin/env bash
# codex-panel-ab.sh — A/B: one holistic `codex exec review` vs a 3-dimension
# focused panel (plain `codex exec` workers), on the current branch's diff
# against a base branch. Decides whether /phx:review deserves --codex-panel.
#
# Usage: run from the target project repo, on a FRESH (not yet
# codex-reviewed) branch:
#   bash codex-panel-ab.sh [base-branch] [output-dir]
# Defaults: base=main, output=./codex-panel-ab-<timestamp>/
#
# Cost: 4 codex runs (~2-5 min each, run in parallel). Read-only sandbox.
# Output: 4 findings .md files + stream .log files + a comparison stub.
set -uo pipefail

BASE="${1:-main}"
OUT="${2:-codex-panel-ab-$(date +%Y-%m-%d-%H%M)}"
mkdir -p "$OUT"

command -v codex >/dev/null || { echo "codex CLI not found"; exit 1; }
git rev-parse --verify "origin/$BASE" >/dev/null 2>&1 || { echo "no origin/$BASE"; exit 1; }
[[ -n "$(git status --short)" ]] && echo "WARN: dirty tree — codex may flag local dirt"

GUARD="Report each finding as '- [P1|P2|P3] title — file:line' plus 2-3 sentences citing the actual code. Scope discipline: ONLY issues introduced by this diff (git diff origin/$BASE...HEAD). If you find no genuine issues in your focus area, output exactly 'NO FINDINGS' — do NOT manufacture findings, do NOT report pre-existing issues outside the diff."

focus_prompt() { # $1 = dimension description
  echo "Review ONLY the changes introduced by this branch relative to origin/$BASE (run: git diff origin/$BASE...HEAD) with a strict focus on $1. $GUARD"
}

echo "Running 1 holistic + 3 focused codex reviews against origin/$BASE (parallel, ~5 min)..."

codex exec review --base "$BASE" --ephemeral \
  -o "$OUT/holistic.md" > "$OUT/holistic.log" 2>&1 &

codex exec --ephemeral -s read-only -o "$OUT/security.md" \
  "$(focus_prompt "SECURITY: authorization gaps, SQL/tsquery injection, unsafe atom creation from user input, XSS, secrets exposure, DoS vectors")" \
  > "$OUT/security.log" 2>&1 &

codex exec --ephemeral -s read-only -o "$OUT/ecto.md" \
  "$(focus_prompt "ECTO AND DATA CORRECTNESS: N+1 queries, missing preloads, row multiplication from has_many joins, implicit cross joins, float money, unpinned query values, migration hazards, constraint gaps")" \
  > "$OUT/ecto.log" 2>&1 &

codex exec --ephemeral -s read-only -o "$OUT/liveview.md" \
  "$(focus_prompt "LIVEVIEW AND CONCURRENCY: unconditional queries in mount, missing streams for large lists, unauthorized handle_event, assign bloat, PubSub double-subscribe, unsupervised processes, race conditions")" \
  > "$OUT/liveview.log" 2>&1 &

wait
echo "Done. Findings:"
for f in holistic security ecto liveview; do
  n=$(grep -c '^- \[P' "$OUT/$f.md" 2>/dev/null || echo 0)
  echo "  $f: $n finding(s)  ($OUT/$f.md)"
done

cat > "$OUT/COMPARE.md" <<'EOF'
# Comparison checklist

For each focused finding, classify against holistic.md:
- DUPLICATE — holistic already found it → panel adds no value here
- REAL MISS — genuine issue holistic missed → +1 for --codex-panel
- FALSE POSITIVE — manufactured/pre-existing/wrong → -1 for --codex-panel

Verdict rule of thumb: build --codex-panel only if REAL MISS > FALSE POSITIVE
across 2+ fresh branches. Log the result to lab/findings/interesting.jsonl.
EOF
echo "Next: fill in $OUT/COMPARE.md (classify each focused finding vs holistic)."
