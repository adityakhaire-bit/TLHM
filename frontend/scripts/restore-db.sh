#!/bin/bash
# Restore the Terence Media Hub database from a backup made by `npm run backup`.
#
#   scripts/restore-db.sh "/Volumes/Extreme SSD/TMH-Media/database-backups/tmh-db-20261119-020000-daily.sql.gz"
#
# THIS REPLACES THE CURRENT DATABASE CONTENTS. A safety backup of the current database is taken first.
# Stop the app and worker before restoring (see README: "Stopping the services").
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP="${1:-}"
if [[ -z "$BACKUP" || ! -f "$BACKUP" ]]; then
  echo "Usage: scripts/restore-db.sh <path to tmh-db-*.sql.gz>"
  echo "Available backups:"
  ls -1t "$(grep -E '^MEDIA_STORAGE_ROOT=' .env | cut -d= -f2- | tr -d '"')/database-backups/"tmh-db-*.sql.gz 2>/dev/null | head -10 || echo "  (none found)"
  exit 1
fi
gzip -t "$BACKUP" || { echo "The backup file is damaged (gzip check failed). Not restoring."; exit 1; }

DB_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
MYSQL="${MYSQL_PATH:-/opt/homebrew/bin/mysql}"

echo "About to REPLACE the current database with:"
echo "  $BACKUP"
read -r -p "Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }

echo "Taking a safety backup of the current database first..."
npx tsx scripts/backup-db.ts --trigger manual || { echo "Safety backup failed; not restoring."; exit 1; }

# Credentials go through a private temporary file so the password never appears in the process list.
CNF="$(mktemp -t tmh-restore)"
trap 'rm -f "$CNF"' EXIT
chmod 600 "$CNF"
node -e '
const u = new URL(process.argv[1]);
const q = (v) => decodeURIComponent(v).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
process.stdout.write(`[client]\nuser="${q(u.username)}"\npassword="${q(u.password)}"\nhost="${u.hostname}"\nport=${u.port || 3306}\n`);
' "$DB_URL" > "$CNF"

echo "Restoring..."
gunzip -c "$BACKUP" | "$MYSQL" --defaults-extra-file="$CNF" --default-character-set=utf8mb4
echo "Restore complete. Start the services again, then open the app to check."
