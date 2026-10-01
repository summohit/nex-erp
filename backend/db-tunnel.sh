#!/bin/bash
# Opens an SSH tunnel: localhost:5434 → VPS Postgres (127.0.0.1:5433 on the server).
# Local backend then talks to the LIVE production database. Ctrl+C to close.
echo "Tunnel open on localhost:5434 → VPS nex_erp (LIVE DATA). Ctrl+C to stop."
exec ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 5434:127.0.0.1:5433 root@94.136.188.176
