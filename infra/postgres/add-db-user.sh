#!/bin/bash
# Creates one Postgres login for one person, so access is per-person and can be
# revoked without touching the backend's own password.
#
#   ./add-db-user.sh saanvi readonly      # SELECT only (the default)
#   ./add-db-user.sh saanvi readwrite     # SELECT/INSERT/UPDATE/DELETE, no DDL
#   ./add-db-user.sh saanvi revoke        # remove the login
#
# Prints the connection string once. The password is not stored anywhere else.
set -euo pipefail
cd "$(dirname "$0")"
source .env

NAME="${1:?usage: $0 <name> [readonly|readwrite|revoke]}"
MODE="${2:-readonly}"
[[ "$NAME" =~ ^[a-z][a-z0-9_]{1,30}$ ]] || { echo "Name must be lowercase letters, digits, underscore."; exit 1; }
ROLE="dev_${NAME}"
PSQL=(docker exec -i nex-erp-postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q)

if [[ "$MODE" == "revoke" ]]; then
  "${PSQL[@]}" <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '${ROLE}';
REASSIGN OWNED BY "${ROLE}" TO "${POSTGRES_USER}";
DROP OWNED BY "${ROLE}";
DROP ROLE IF EXISTS "${ROLE}";
SQL
  echo "Removed ${ROLE}."
  exit 0
fi

case "$MODE" in
  readonly)  PRIVS="SELECT";                          SEQ="SELECT" ;;
  readwrite) PRIVS="SELECT, INSERT, UPDATE, DELETE";  SEQ="USAGE, SELECT" ;;
  *) echo "Mode must be readonly, readwrite or revoke."; exit 1 ;;
esac

PASS="$(openssl rand -hex 20)"

"${PSQL[@]}" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
    CREATE ROLE "${ROLE}" LOGIN;
  END IF;
END \$\$;
ALTER ROLE "${ROLE}" WITH LOGIN PASSWORD '${PASS}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 5;
-- Start from nothing, then grant exactly the mode asked for.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${ROLE}";
GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO "${ROLE}";
GRANT USAGE ON SCHEMA public TO "${ROLE}";
GRANT ${PRIVS} ON ALL TABLES IN SCHEMA public TO "${ROLE}";
GRANT ${SEQ} ON ALL SEQUENCES IN SCHEMA public TO "${ROLE}";
-- Tables created later by migrations get the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public GRANT ${PRIVS} ON TABLES TO "${ROLE}";
ALTER DEFAULT PRIVILEGES FOR ROLE "${POSTGRES_USER}" IN SCHEMA public GRANT ${SEQ} ON SEQUENCES TO "${ROLE}";
SQL

HOST="${TAILSCALE_IP:-<vps-tailscale-ip>}"
echo
echo "Created ${ROLE} (${MODE}). Send this privately — it is not saved anywhere:"
echo
echo "  postgresql://${ROLE}:${PASS}@${HOST}:5433/${POSTGRES_DB}?schema=public"
echo
