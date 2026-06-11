#!/usr/bin/env bash
# watch-pr.sh — quiet GitHub PR watcher. Emits ONE line per genuinely-new event.
# Designed for the Monitor tool / run_in_background. stdout = event stream.
# Exits (terminal line first) on: PR closed/merged, max duration, or repeated
# gh failures. Silence is never success — every terminal state emits a line.
set -uo pipefail

PR="${1:?usage: watch-pr.sh <pr-number> [reviews,comments,checks]}"
WATCH="${2:-reviews,comments,checks}"
INTERVAL="${WATCH_INTERVAL:-30}"
MAX_DURATION="${WATCH_MAX_DURATION:-3600}"
DELTA_FILE="${WATCH_DELTA_FILE:-.claude/watch/pr-${PR}.jsonl}"
mkdir -p "$(dirname "$DELTA_FILE")"

START_EPOCH=$(date -u +%s)
BASELINE_TS="${WATCH_BASELINE_TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
FAIL_COUNT=0

emit() { # emit <json-line>  -> stdout event + append to delta file
  printf '%s\n' "$1"
  printf '%s\n' "$1" >> "$DELTA_FILE"
}
has() { case ",$WATCH," in *",$1,"*) return 0;; *) return 1;; esac; }

# Track what we've already reported (ids / conclusions) to avoid dupes.
SEEN_REVIEWS=""; SEEN_COMMENTS=""; LAST_CHECK_STATE=""

while :; do
  NOW_EPOCH=$(date -u +%s)
  if (( NOW_EPOCH - START_EPOCH >= MAX_DURATION )); then
    emit "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"kind\":\"watchdog\",\"summary\":\"stopped after ${MAX_DURATION}s\"}"
    exit 0
  fi

  # One cheap call covers state, reviews, comments, checks. || true keeps us alive.
  VIEW=$(gh pr view "$PR" \
    --json state,mergedAt,reviews,comments,statusCheckRollup,updatedAt 2>/dev/null) || true
  if [[ -z "$VIEW" ]]; then
    FAIL_COUNT=$((FAIL_COUNT+1))
    if (( FAIL_COUNT >= 5 )); then
      emit "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"kind\":\"watch_error\",\"summary\":\"5 consecutive gh failures\"}"
      exit 1
    fi
    sleep "$INTERVAL"; continue
  fi
  FAIL_COUNT=0

  STATE=$(jq -r '.state' <<<"$VIEW")

  # --- reviews (bot + human) newer than baseline, not yet seen ---
  if has reviews; then
    while IFS=$'\t' read -r rid author rstate submitted; do
      [[ -z "$rid" ]] && continue
      [[ "$submitted" > "$BASELINE_TS" ]] || continue
      case " $SEEN_REVIEWS " in *" $rid "*) continue;; esac
      SEEN_REVIEWS="$SEEN_REVIEWS $rid"
      emit "{\"ts\":\"$submitted\",\"kind\":\"review\",\"author\":\"$author\",\"state\":\"$rstate\"}"
    done < <(jq -r '.reviews[] | [(.id|tostring), .author.login, .state, .submittedAt] | @tsv' <<<"$VIEW")
  fi

  # --- comments newer than baseline, not yet seen ---
  if has comments; then
    while IFS=$'\t' read -r cid author created; do
      [[ -z "$cid" ]] && continue
      [[ "$created" > "$BASELINE_TS" ]] || continue
      case " $SEEN_COMMENTS " in *" $cid "*) continue;; esac
      SEEN_COMMENTS="$SEEN_COMMENTS $cid"
      emit "{\"ts\":\"$created\",\"kind\":\"comment\",\"author\":\"$author\"}"
    done < <(jq -r '.comments[] | [(.id|tostring), (.author.login // "unknown"), .createdAt] | @tsv' <<<"$VIEW")
  fi

  # --- checks: emit on terminal conclusion change ---
  if has checks; then
    CHECK=$(jq -r '
      (.statusCheckRollup // [])
      | {pending: ([.[] | select((.status // .state) != "COMPLETED" and (.conclusion // "") == "")] | length),
         failure: ([.[] | select((.conclusion // .state) == "FAILURE" or (.conclusion // "") == "FAILURE")] | length),
         total:   (length)}
      | "pending=\(.pending) failure=\(.failure) total=\(.total)"' <<<"$VIEW")
    if [[ "$CHECK" != "$LAST_CHECK_STATE" ]]; then
      LAST_CHECK_STATE="$CHECK"
      PENDING=$(sed -n 's/.*pending=\([0-9]*\).*/\1/p' <<<"$CHECK")
      FAILS=$(sed -n 's/.*failure=\([0-9]*\).*/\1/p' <<<"$CHECK")
      if [[ "${PENDING:-1}" == "0" ]]; then
        CONC=$([[ "${FAILS:-0}" == "0" ]] && echo success || echo failure)
        emit "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"kind\":\"check\",\"conclusion\":\"$CONC\",\"summary\":\"$CHECK\"}"
      fi
    fi
  fi

  # --- terminal: PR no longer open ---
  if [[ "$STATE" != "OPEN" ]]; then
    KIND=$([[ "$STATE" == "MERGED" ]] && echo merged || echo pr_closed)
    emit "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"kind\":\"$KIND\",\"state\":\"$STATE\"}"
    exit 0
  fi

  sleep "$INTERVAL"
done
