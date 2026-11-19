#!/bin/bash
# Use ONLY if the MySQL root password is forgotten (Homebrew MySQL on this Mac).
# Run it yourself in a terminal:   bash scripts/setup/reset-mysql-root.sh
#
# What it does:
#   1. Stops the Homebrew MySQL service.
#   2. Starts MySQL temporarily in recovery mode (no network, local socket only).
#   3. Sets the root password to one YOU type (hidden), and sets a new generated password for tmh_app.
#   4. Stops recovery mode and starts the normal MySQL service again.
#   5. Saves the new tmh_app password into .env (backup copy of .env kept). Root's password is not saved anywhere.
# No databases or tables are changed or deleted.
set -euo pipefail
cd "$(dirname "$0")/../.."

BREW=/opt/homebrew/bin/brew
MYSQL=/opt/homebrew/bin/mysql
SERVICE="$("$BREW" services list | awk '/^mysql/ {print $1; exit}')"
[[ -n "$SERVICE" ]] || { echo "No Homebrew MySQL service found."; exit 1; }
MYSQLD="$("$BREW" --prefix "$SERVICE")/bin/mysqld"
DATADIR="$(/opt/homebrew/bin/mysqld --verbose --help 2>/dev/null | awk '$1=="datadir" {print $2}')"
DATADIR="${DATADIR:-/opt/homebrew/var/mysql/}"
SOCK="/tmp/tmh-mysql-recovery.sock"
PIDFILE="/tmp/tmh-mysql-recovery.pid"

echo "This resets the MySQL root password for service '$SERVICE' (data folder: $DATADIR)."
echo "MySQL will be stopped for about 30 seconds. No data is deleted."
read -r -p "Type RESET to continue: " CONFIRM
[[ "$CONFIRM" == "RESET" ]] || { echo "Cancelled."; exit 1; }

read -r -s -p "Choose a NEW MySQL root password (min 8 chars, hidden): " ROOT_PW; echo
read -r -s -p "Repeat it: " ROOT_PW2; echo
[[ "$ROOT_PW" == "$ROOT_PW2" ]] || { echo "Passwords do not match."; exit 1; }
[[ ${#ROOT_PW} -ge 8 ]] || { echo "Too short."; exit 1; }
unset ROOT_PW2
APP_PW="$(openssl rand -hex 16)"

restore_service() {
  if [[ -f "$PIDFILE" ]]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 5; fi
  rm -f "$PIDFILE"
  "$BREW" services start "$SERVICE" >/dev/null 2>&1 || true
}
trap restore_service EXIT

echo "Stopping $SERVICE..."
"$BREW" services stop "$SERVICE" >/dev/null
for _ in $(seq 1 30); do pgrep -x mysqld >/dev/null || break; sleep 1; done
pgrep -x mysqld >/dev/null && { echo "MySQL did not stop; aborting."; exit 1; }

echo "Starting recovery mode..."
"$MYSQLD" --datadir="$DATADIR" --skip-grant-tables --skip-networking --socket="$SOCK" --pid-file="$PIDFILE" --mysqlx=OFF >/tmp/tmh-mysql-recovery.log 2>&1 &
for _ in $(seq 1 30); do [[ -S "$SOCK" ]] && break; sleep 1; done
[[ -S "$SOCK" ]] || { echo "Recovery mode did not start. See /tmp/tmh-mysql-recovery.log"; exit 1; }

esc() { printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g"; }
HOSTS="$("$MYSQL" --socket="$SOCK" -u root -N -e "SELECT host FROM mysql.user WHERE user='tmh_app'")"
{
  echo "FLUSH PRIVILEGES;"
  echo "ALTER USER 'root'@'localhost' IDENTIFIED BY '$(esc "$ROOT_PW")';"
  if [[ -z "$HOSTS" ]]; then
    echo "CREATE USER 'tmh_app'@'localhost' IDENTIFIED BY '$APP_PW';"
    echo "GRANT ALL PRIVILEGES ON terence_media_hub.* TO 'tmh_app'@'localhost';"
    echo "GRANT CREATE, ALTER, DROP, REFERENCES ON *.* TO 'tmh_app'@'localhost';"
  else
    for host in $HOSTS; do echo "ALTER USER 'tmh_app'@'$host' IDENTIFIED BY '$APP_PW';"; done
  fi
  echo "CREATE DATABASE IF NOT EXISTS terence_media_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
} | "$MYSQL" --socket="$SOCK" -u root
unset ROOT_PW

echo "Returning to normal mode..."
restore_service
trap - EXIT
for _ in $(seq 1 30); do /opt/homebrew/bin/mysqladmin --protocol=tcp -h 127.0.0.1 ping >/dev/null 2>&1 && break; sleep 1; done

cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
APP_PW="$APP_PW" python3 - <<'EOF'
import os, re
text = open(".env").read()
text = re.sub(r'^(DATABASE_URL="?mysql://[^:]+:)[^@]*(@)', lambda m: m.group(1) + os.environ["APP_PW"] + m.group(2), text, count=1, flags=re.M)
open(".env", "w").write(text)
EOF
chmod 600 .env

CNF="$(mktemp -t tmh-app)"; chmod 600 "$CNF"
printf '[client]\nuser=tmh_app\npassword="%s"\nhost=127.0.0.1\nport=3306\n' "$APP_PW" > "$CNF"
unset APP_PW
if "$MYSQL" --defaults-extra-file="$CNF" -N -e "SELECT CONCAT('Signed in as ', CURRENT_USER())" terence_media_hub; then
  rm -f "$CNF"
  echo "Done. Root password = the one you just chose (remember it). tmh_app password saved in .env (not shown)."
else
  rm -f "$CNF"
  echo "Passwords were reset but the test login failed. Tell Claude what you see."
  exit 1
fi
