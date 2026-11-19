#!/bin/bash
# Read-only environment check for the TMH Mac mini. Changes nothing.
#   npm run check:env
# Reports: Node/npm, FFmpeg + VideoToolbox, mounted external volumes (and which look like TMH storage),
# the configured MEDIA_STORAGE_ROOT, free space, USB link speed of the SSD, ports, and Firebase config.
cd "$(dirname "$0")/../.." || exit 1
ok() { printf "  \033[32m✔\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✘\033[0m %s\n" "$1"; }
env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e 's/[[:space:]]*#.*$//'; }

echo "Tools"
command -v node >/dev/null && ok "node $(node -v), npm $(npm -v)" || bad "node is not installed"
FFMPEG="$(env_value FFMPEG_PATH)"; FFMPEG="${FFMPEG:-/opt/homebrew/bin/ffmpeg}"
FFPROBE="$(env_value FFPROBE_PATH)"; FFPROBE="${FFPROBE:-/opt/homebrew/bin/ffprobe}"
if [[ -x "$FFMPEG" ]]; then
  ok "ffmpeg: $("$FFMPEG" -version | head -1 | cut -d' ' -f1-3)"
  "$FFMPEG" -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox && ok "VideoToolbox hardware H.264 available" || warn "h264_videotoolbox missing; proxies will use slower libx264"
else bad "ffmpeg not found at $FFMPEG (brew install ffmpeg)"; fi
[[ -x "$FFPROBE" ]] && ok "ffprobe found" || bad "ffprobe not found at $FFPROBE"

echo "External volumes"
found=0
for vol in /Volumes/*; do
  [[ -L "$vol" ]] && continue
  info="$(diskutil info "$vol" 2>/dev/null)"
  echo "$info" | grep -q "Device Location:.*External" || continue
  found=1
  fs="$(echo "$info" | awk -F: '/File System Personality/ {gsub(/^ +/,"",$2); print $2}')"
  free="$(df -h "$vol" | awk 'NR==2 {print $4}')"
  marker=""; [[ -f "$vol/TMH-Media/.tmh-storage" ]] && marker=" ← contains TMH-Media"
  ok "$vol ($fs, $free free)$marker"
  [[ "$fs" == "ExFAT" ]] && warn "$vol is exFAT: fine for media files, never for a live database; always eject before unplugging"
done
[[ $found -eq 0 ]] && bad "No external drive mounted. Connect the SSD."

echo "Configured storage"
ROOT="$(env_value MEDIA_STORAGE_ROOT)"
if [[ -z "$ROOT" ]]; then bad "MEDIA_STORAGE_ROOT is not set in .env"
elif [[ ! -d "$ROOT" ]]; then bad "MEDIA_STORAGE_ROOT not found: $ROOT (drive unplugged or path wrong)"
elif [[ ! -f "$ROOT/.tmh-storage" ]]; then bad "$ROOT has no .tmh-storage marker (run scripts/setup/init-storage.sh)"
elif [[ ! -w "$ROOT" ]]; then bad "$ROOT is not writable"
else ok "$ROOT is mounted, marked and writable ($(df -h "$ROOT" | awk 'NR==2 {print $4}') free)"; fi
speed="$(system_profiler SPUSBHostDataType SPUSBDataType 2>/dev/null | grep -A4 -iE 'sandisk|extreme' | grep -m1 'Link Speed' | sed 's/^ *//')"
[[ -n "$speed" ]] && { echo "$speed" | grep -q "480 Mb/s" && warn "SSD $speed (USB 2.0). Plug it into a USB-C/Thunderbolt port." || ok "SSD $speed"; }

echo "Ports"
for port in "$(env_value BACKEND_PORT)" 3000; do
  [[ -z "$port" ]] && continue
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [[ -n "$pid" ]] && warn "port $port in use by $(ps -o comm= -p "$pid")" || ok "port $port free"
done

echo "Firebase"
[[ -n "$(env_value NEXT_PUBLIC_FIREBASE_PROJECT_ID)" ]] && ok "web config for project $(env_value NEXT_PUBLIC_FIREBASE_PROJECT_ID)" || warn "web config not set (NEXT_PUBLIC_FIREBASE_*)"
CRED="$(env_value GOOGLE_APPLICATION_CREDENTIALS)"
if [[ -z "$CRED" ]]; then warn "GOOGLE_APPLICATION_CREDENTIALS not set (needed in Phase 2)"
elif [[ ! -f "$CRED" ]]; then warn "service-account file not found at $CRED (needed in Phase 2)"
else
  perms="$(stat -f %Lp "$CRED")"
  [[ "$perms" == "600" || "$perms" == "400" ]] && ok "service-account file present (permissions $perms)" || warn "service-account file permissions are $perms; run: chmod 600 \"$CRED\""
  case "$(cd "$(dirname "$CRED")" && pwd)" in "$(pwd)"*) bad "service-account file is INSIDE the repository; move it out";; esac
fi
