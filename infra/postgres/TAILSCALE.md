# Connecting to the database over Tailscale

One connection string per person, usable from any laptop on the tailnet —
no SSH tunnel, and the database is still not reachable from the internet.

```
postgresql://dev_saanvi:<password>@<vps-tailscale-ip>:5433/nex_erp?schema=public
```

⚠️ This is the **live production database**. Hand out `readonly` unless someone
truly needs to write, and never run `prisma db push`, `migrate reset` or seeds
against it.

## 1. Put the VPS on the tailnet (once)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh=false          # opens a login link; approve it in the admin console
tailscale ip -4                   # note this 100.x.y.z address
```
In the Tailscale admin console, open the VPS → **Disable key expiry**, otherwise
it drops off the tailnet after 180 days and every connection string stops working.

## 2. Start Docker after Tailscale (once)
Docker binds to the Tailscale address. If Docker starts before Tailscale at boot,
that address does not exist yet and **Postgres fails to start — taking the
backend down with it.** Make Docker wait:
```bash
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/after-tailscale.conf <<'EOF'
[Unit]
After=tailscaled.service
Wants=tailscaled.service
EOF
systemctl daemon-reload
```

## 3. Publish Postgres on the Tailscale address
```bash
cd /var/www/nex-erp/infra/postgres
echo "TAILSCALE_IP=$(tailscale ip -4)" >> .env
docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d
docker compose ps                                  # healthy?
ss -ltnp | grep 5433                               # expect 127.0.0.1:5433 AND 100.x.y.z:5433 — NOT 0.0.0.0
```
The container restarts (a few seconds of downtime for the backend). From now on,
always start it with both `-f` files, or the Tailscale listener disappears.

## 4. Give someone access
```bash
./add-db-user.sh saanvi readonly      # or: readwrite   (never DDL)
```
It prints the connection string once. Send it privately. To take access away:
```bash
./add-db-user.sh saanvi revoke
```
Also remove their device in the Tailscale admin console — that cuts network
access even if a password leaked.

## 5. On their laptop
1. Install Tailscale and sign in to **your** tailnet (invite them from the admin console).
2. Test: `Test-NetConnection -ComputerName 100.x.y.z -Port 5433` (Windows) or
   `nc -vz 100.x.y.z 5433` (Mac/Linux) → should say `True` / `succeeded`.
3. Put the string in `backend/.env` as `DATABASE_URL`, or paste it into a DB client
   (DBeaver, TablePlus, pgAdmin).

## Restrict it further (recommended)
Tailscale ACLs can limit who on the tailnet may reach port 5433 at all — e.g.
only the developers' group, not every device you ever add:
```json
{ "action": "accept", "src": ["group:developers"], "dst": ["tag:db:5433"] }
```
