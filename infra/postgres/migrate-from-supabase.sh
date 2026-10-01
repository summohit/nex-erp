#!/bin/bash
# One-time copy of the Supabase database into the local Postgres container.
# Run ON THE VPS:  SUPABASE_URL='postgresql://...:5432/postgres' ./migrate-from-supabase.sh
# Use Supabase's DIRECT/session connection (port 5432), not the 6543 pooler.
set -euo pipefail
cd "$(dirname "$0")"
: "${SUPABASE_URL:?set SUPABASE_URL to the Supabase direct connection string}"
source .env

DUMP=/root/supabase-$(date +%F-%H%M).dump
echo "→ Dumping Supabase (public schema) to $DUMP"
docker run --rm -v /root:/root postgres:17 \
  pg_dump "$SUPABASE_URL" --schema=public --no-owner --no-privileges -Fc -f "$DUMP"

echo "→ Restoring into nex-erp-postgres (replaces its public schema)"
docker exec nex-erp-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q \
  -c "DROP SCHEMA IF EXISTS public CASCADE;"
docker cp "$DUMP" nex-erp-postgres:/tmp/restore.dump
docker exec nex-erp-postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges --exit-on-error /tmp/restore.dump
docker exec nex-erp-postgres rm /tmp/restore.dump
docker exec nex-erp-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"

echo "→ Row counts (compare with Supabase):"
docker exec nex-erp-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 25;"
echo "✔ Done. Keep $DUMP until you've verified the app."
