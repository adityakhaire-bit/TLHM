#!/bin/bash
# Prepares a TMH storage folder on an external drive. Only CREATES folders and the marker file;
# it never deletes, moves or overwrites anything that already exists on the drive.
#
#   scripts/setup/init-storage.sh                         # uses MEDIA_STORAGE_ROOT from .env
#   scripts/setup/init-storage.sh "/Volumes/Other SSD/TMH-Media"
set -euo pipefail
cd "$(dirname "$0")/../.."

ROOT="${1:-$(grep -E '^MEDIA_STORAGE_ROOT=' .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')}"
[[ -n "$ROOT" ]] || { echo "Usage: $0 \"/Volumes/<Drive>/TMH-Media\" (or set MEDIA_STORAGE_ROOT in .env)"; exit 1; }
VOLUME="$(echo "$ROOT" | sed -E 's#^(/Volumes/[^/]+).*#\1#')"
if [[ "$ROOT" == /Volumes/* && ! -d "$VOLUME" ]]; then
  echo "The drive $VOLUME is not mounted. Connect it first; nothing was created."; exit 1
fi

mkdir -p "$ROOT"
for dir in originals/videos originals/audio originals/images proxies/videos proxies/audio thumbnails uploads-temp database-backups metadata logs; do
  mkdir -p "$ROOT/$dir"
done
if [[ -f "$ROOT/.tmh-storage" ]]; then
  echo "Marker already present; left unchanged."
else
  printf 'Terence Media Hub storage root. Do not rename, move or edit by hand.\nThe app refuses to write here if this marker file is missing (for example when the drive is unplugged).\n' > "$ROOT/.tmh-storage"
  echo "Created marker file."
fi
echo "Storage ready at: $ROOT"
