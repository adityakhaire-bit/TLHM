#!/bin/bash
# Installs Terence Media Hub as two macOS launchd services that start at login and restart if they crash:
#   com.terencemediahub.web     the web app + API   (npm run start, port from .env PORT, default 3000)
#   com.terencemediahub.worker  the FFmpeg worker + daily database backup
#
#   scripts/install-services.sh            install / update and start
#   scripts/install-services.sh uninstall  stop and remove
#
# Run `npm run build` first. Logs: ~/Library/Logs/terence-media-hub/
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/terence-media-hub"
NODE_DIR="$(dirname "$(command -v node)")"
DOMAIN="gui/$(id -u)"
LABELS=(com.terencemediahub.web com.terencemediahub.worker)

if [[ "${1:-}" == "uninstall" ]]; then
  for label in "${LABELS[@]}"; do
    launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
    rm -f "$AGENTS_DIR/$label.plist"
    echo "Removed $label"
  done
  exit 0
fi

[[ -d "$PROJECT_DIR/.next" ]] || { echo "Build the app first: npm run build"; exit 1; }
mkdir -p "$AGENTS_DIR" "$LOG_DIR"

for label in "${LABELS[@]}"; do
  sed -e "s|__PROJECT_DIR__|$PROJECT_DIR|g" -e "s|__NODE_DIR__|$NODE_DIR|g" -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$PROJECT_DIR/deploy/launchd/$label.plist.template" > "$AGENTS_DIR/$label.plist"
  plutil -lint "$AGENTS_DIR/$label.plist" >/dev/null
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$AGENTS_DIR/$label.plist"
  echo "Started $label"
done
echo "Logs: $LOG_DIR"
echo "Check status: launchctl print $DOMAIN/com.terencemediahub.web | grep state"
