#!/usr/bin/env bash
# SkillSpector security scan for the elixir-phoenix plugin.
#
# Static-only (--no-llm) => zero data egress. Scans every distributed skill and
# agent, applies reviewed baselines for the 4 components whose findings are
# documented false positives (see SECURITY.md), and fails (exit 1) on any NEW
# DO_NOT_INSTALL finding.
#
# Install:  pipx install --python python3.13 "git+https://github.com/NVIDIA/skillspector.git"
# Run:      lab/skillspector/scan.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGIN="$ROOT/plugins/elixir-phoenix"
BASEDIR="$ROOT/lab/skillspector/baselines"
command -v skillspector >/dev/null || { echo "skillspector not on PATH"; exit 2; }

# component path (relative to plugin) -> baseline file. Reviewed false
# positives only (see SECURITY.md). bash 3.2 compatible (no assoc arrays).
baseline_for() {
  case "$1" in
    skills/permissions)            echo permissions.yaml ;;
    skills/deps-audit)             echo deps-audit.yaml ;;
    skills/quick)                  echo quick.yaml ;;
    agents/ash-policy-reviewer.md) echo ash-policy-reviewer.yaml ;;
    *)                             echo "" ;;
  esac
}

fail=0; scanned=0; flagged=0
scan_one() {
  local rel="$1" args
  args=(scan "$PLUGIN/$1" --no-llm)
  local bl; bl="$(baseline_for "$rel")"
  [ -n "$bl" ] && args+=(--baseline "$BASEDIR/$bl")
  skillspector "${args[@]}" >/dev/null 2>&1
  local code=$?
  scanned=$((scanned+1))
  if [ "$code" -eq 1 ]; then
    flagged=$((flagged+1)); fail=1
    echo "  DO_NOT_INSTALL: $rel"
  fi
}

echo "== Scanning skills =="
for d in "$PLUGIN"/skills/*/; do scan_one "skills/$(basename "$d")"; done
echo "== Scanning agents =="
for f in "$PLUGIN"/agents/*.md; do scan_one "agents/$(basename "$f")"; done

echo "== $scanned components scanned, $flagged flagged (after reviewed baselines) =="
exit $fail
