#!/bin/bash
# Resets the password of the MySQL app user (tmh_app) when it has been forgotten, and stores the new
# password in .env. The new password is generated here and never printed.
#
#   bash scripts/setup/reset-mysql-app-password.sh
#
# You will be asked for the MySQL *root* password (typed hidden). Nothing else is changed:
# no databases or tables are touched, only the tmh_app password.
set -euo pipefail
cd "$(dirname "$0")/../.."

MYSQL="${MYSQL_PATH:-/opt/homebrew/bin/mysql}"
APP_USER="tmh_app"
[[ -x "$MYSQL" ]] || { echo "mysql client not found at $MYSQL"; exit 1; }
[[ -f .env ]] || { echo ".env not found in $(pwd)"; exit 1; }
grep -q '^DATABASE_URL=' .env || { echo "DATABASE_URL line not found in .env"; exit 1; }

CNF="$(mktemp -t tmh-root)"
trap 'rm -f "$CNF"' EXIT
chmod 600 "$CNF"

read -r -s -p "MySQL root password (hidden, press Return if it has none): " ROOT_PW; echo
printf '[client]\nuser=root\npassword="%s"\nhost=127.0.0.1\nport=3306\n' "${ROOT_PW//\"/\\\"}" > "$CNF"
unset ROOT_PW

if ! "$MYSQL" --defaults-extra-file="$CNF" -N -e "SELECT 1" >/dev/null 2>&1; then
  echo "Could not sign in to MySQL as root with that password."
  echo "If the root password is also forgotten, ask Claude for the 'reset MySQL root password' steps."
  exit 1
fi

HOSTS="$("$MYSQL" --defaults-extra-file="$CNF" -N -e "SELECT host FROM mysql.user WHERE user='$APP_USER'")"
if [[ -z "$HOSTS" ]]; then
  echo "User $APP_USER does not exist yet; creating $APP_USER@localhost."
  HOSTS="localhost"
  CREATE=1
else
  CREATE=0
fi

# Letters and digits only, so it needs no escaping in the DATABASE_URL.
NEW_PW="$(openssl rand -hex 16)"

{
  for host in $HOSTS; do
    if [[ $CREATE -eq 1 ]]; then
      echo "CREATE USER '$APP_USER'@'$host' IDENTIFIED BY '$NEW_PW';"
      echo "GRANT ALL PRIVILEGES ON terence_media_hub.* TO '$APP_USER'@'$host';"
      echo "GRANT CREATE, ALTER, DROP, REFERENCES ON *.* TO '$APP_USER'@'$host';"
    else
      echo "ALTER USER '$APP_USER'@'$host' IDENTIFIED BY '$NEW_PW';"
    fi
  done
  echo "CREATE DATABASE IF NOT EXISTS terence_media_hub CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
  echo "FLUSH PRIVILEGES;"
} | "$MYSQL" --defaults-extra-file="$CNF"

# Update .env (keep a backup copy; .env* files are git-ignored).
cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)"
NEW_PW="$NEW_PW" python3 - <<'EOF'
import os, re
path = ".env"
text = open(path).read()
text = re.sub(r'^(DATABASE_URL="?mysql://[^:]+:)[^@]*(@)', lambda m: m.group(1) + os.environ["NEW_PW"] + m.group(2), text, count=1, flags=re.M)
open(path, "w").write(text)
EOF
chmod 600 .env

# Verify the new login works (password taken from the updated .env, not printed).
printf '[client]\nuser=%s\npassword="%s"\nhost=127.0.0.1\nport=3306\n' "$APP_USER" "$NEW_PW" > "$CNF"
unset NEW_PW
if "$MYSQL" --defaults-extra-file="$CNF" -N -e "SELECT CONCAT('Signed in as ', CURRENT_USER())" terence_media_hub; then
  echo "Done. The new $APP_USER password is saved in .env (not shown). A backup of the old .env was made."
else
  echo "The password was changed but the test login failed. Tell Claude what you see."
  exit 1
fi
