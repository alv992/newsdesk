#!/usr/bin/env bash
#
# Refresh everything, in order. The brief must run last: it reads what the
# other three wrote.
#
# Deliberately not `set -e`. If one step fails the rest should still run —
# a broken markets fetch should not cost you the news.
#
# This is the script the 07:00 timer will run on the Pi.
#
#   ./refresh.sh              everything
#   ./refresh.sh --no-brief   skip the model, just the data
#   ./refresh.sh --fast       data plus the market half of the brief

set -uo pipefail
cd "$(dirname "$0")"

BRIEF=full
case "${1:-}" in
  --no-brief) BRIEF=none ;;
  --fast)     BRIEF=markets ;;
  "")         ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

failed=0
step() {
  local name=$1; shift
  local start=$SECONDS
  printf '\n\033[1m── %s\033[0m\n' "$name"
  if "$@"; then
    printf '   done in %ss\n' "$((SECONDS - start))"
  else
    printf '   FAILED after %ss\n' "$((SECONDS - start))"
    failed=$((failed + 1))
  fi
}

started=$SECONDS
step "news"       uv run fetch.py
step "indicators" uv run indicators.py
step "markets"    uv run markets.py

case "$BRIEF" in
  full)    step "brief" uv run summarise.py ;;
  markets) step "brief (market half only)" env NEWSDESK_NEWS=skip uv run summarise.py ;;
  none)    printf '\n── brief\n   skipped\n' ;;
esac

printf '\n%s in %ss\n' \
  "$([ $failed -eq 0 ] && echo 'all steps ok' || echo "$failed step(s) failed")" \
  "$((SECONDS - started))"
exit $((failed > 0))
