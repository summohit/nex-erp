#!/bin/bash
# Nightly backup. Cron:  0 2 * * * /var/www/nex-erp/infra/postgres/backup.sh >> /var/log/nex-erp-backup.log 2>&1
# Keeps 14 local copies, and 30 days on RCLONE_REMOTE (e.g. "gdrive:nex-erp-backups")
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
  # A failed upload must be loud: the local copy dies with the server.
  if rclone copy "$FILE" "$RCLONE_REMOTE" 2>/tmp/nex-backup-rclone.err; then
    echo "$(date) ✔ uploaded to $RCLONE_REMOTE"
    rclone delete "$RCLONE_REMOTE" --min-age 30d 2>/dev/null || true
  else
    echo "$(date) ✘ OFF-SERVER UPLOAD FAILED: $(grep -m1 -E 'CRITICAL|ERROR' /tmp/nex-backup-rclone.err)"
    exit 2
  fi
fi
