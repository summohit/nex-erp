#!/bin/bash
# Restore a backup:  ./restore.sh /var/backups/nex-erp/nex_erp-2026-10-01-0200.dump
# DESTRUCTIVE: replaces the current database contents. Stop the backend first.
set -euo pipefail
cd "$(dirname "$0")"
source .env
F="${1:?usage: restore.sh <dump file>}"
read -p "Replace database $POSTGRES_DB with $F? type YES: " ok; [ "$ok" = YES ] || exit 1
docker cp "$F" nex-erp-postgres:/tmp/restore.dump
docker exec nex-erp-postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/restore.dump
docker exec nex-erp-postgres rm /tmp/restore.dump
echo "✔ Restored"
