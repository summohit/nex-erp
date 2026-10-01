#!/bin/bash
# Nightly backup. Cron:  0 2 * * * /var/www/nex-erp/infra/postgres/backup.sh >> /var/log/nex-erp-backup.log 2>&1
# Keeps 14 local copies. Set RCLONE_REMOTE (e.g. "b2:nex-erp-backups") to also
# copy off the server — strongly recommended, a backup on the same disk is not a backup.
set -euo pipefail
cd "$(dirname "$0")"
source .env
DIR=/var/backups/nex-erp; KEEP=14
mkdir -p "$DIR"
FILE="$DIR/nex_erp-$(date +%F-%H%M).dump"

docker exec nex-erp-postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$FILE"
[ -s "$FILE" ] || { echo "$(date) ✘ backup empty"; rm -f "$FILE"; exit 1; }
echo "$(date) ✔ $FILE ($(du -h "$FILE" | cut -f1))"

ls -1t "$DIR"/nex_erp-*.dump | tail -n +$((KEEP+1)) | xargs -r rm --
if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$FILE" "$RCLONE_REMOTE" && echo "$(date) ✔ uploaded to $RCLONE_REMOTE"
fi
