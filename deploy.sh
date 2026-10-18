#!/usr/bin/env bash
# Copy Newsdesk to the Pi, install the daily refresh and (re)start the web server. Run from the laptop:
#   ./deploy.sh [host]
#
# The generated data files are excluded, so a deploy never overwrites what
# the Pi has fetched. rsync --delete leaves excluded files alone.
set -euo pipefail
HOST="${1:-pi-server}"
cd "$(dirname "$0")"

rsync -av --delete \
  --exclude .git --exclude node_modules --exclude tests --exclude __pycache__ \
  --exclude 'data.js*' --exclude 'indicators.js*' --exclude 'markets.js*' \
  --exclude 'summary.js*' --exclude '*.log' \
  --exclude 'MEMORY.md*' --exclude summary-evaluation-results.json \
  --exclude 'package*.json' \
  ./ "$HOST:apps/newsdesk/"

# 05:00 Pi local time, every day: fetch everything, then write the brief.
# Cron has a bare PATH, so point it at uv in ~/.local/bin. Replaces only the
# newsdesk line; other crontab entries are kept.
ssh "$HOST" 'bash -s' <<'EOF'
set -euo pipefail
LINE='0 5 * * * cd "$HOME/apps/newsdesk" && PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" ./refresh.sh >> refresh.log 2>&1 # newsdesk'
{ crontab -l 2>/dev/null | grep -v '# newsdesk$' || true; echo "$LINE"; } | crontab -
echo; echo "crontab:"; crontab -l | grep '# newsdesk$'
echo "Pi time zone: $(timedatectl show -p Timezone --value)"
[ -x "$HOME/.local/bin/uv" ] || echo "WARNING: uv not found in ~/.local/bin — the job will fail until it is installed."

# rsync replaces nginx.conf with a new file, which a running container would
# not see, so recreate it. nginx starts in about a second.
cd "$HOME/apps/newsdesk"
docker compose up -d --force-recreate
docker compose ps
EOF
