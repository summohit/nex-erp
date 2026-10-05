# Self-hosted Postgres (replacing Supabase)

Postgres 17 in Docker on the backend VPS, bound to localhost, with nightly backups.

## 1. Install (on the VPS, once)
```bash
curl -fsSL https://get.docker.com | sh
cd /var/www/nex-erp/infra/postgres
cp .env.example .env
sed -i "s/change-me.*/$(openssl rand -hex 24)/" .env
docker compose up -d
docker compose ps        # should show "healthy"
```
Firewall: make sure 5432 is NOT open publicly (`ufw status` — only 22/80/443).

## 2. Copy data from Supabase
Get the **direct** connection string from Supabase → Project Settings → Database (port 5432).
Pick a quiet time; anything written to Supabase after the dump is lost.
```bash
SUPABASE_URL='postgresql://postgres.xxxx:PASS@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' ./migrate-from-supabase.sh
```
Compare the printed row counts with Supabase's table editor.

## 3. Switch the backend
In `/var/www/nex-erp/backend/.env` (keep the old line commented for rollback):
```
DATABASE_URL="postgresql://nexerp:<POSTGRES_PASSWORD>@127.0.0.1:5433/nex_erp?schema=public"
```
Remove any `?pgbouncer=true` / port 6543 — there's no pooler now. Then restart the
backend (pm2 restart / systemctl restart) and run `npx prisma migrate status`.
Click through login, dashboard, attendance, jobs.

**Rollback:** restore the old Supabase `DATABASE_URL` and restart.

## 4. Backups (do this the same day)
```bash
crontab -e
0 2 * * * /var/www/nex-erp/infra/postgres/backup.sh >> /var/log/nex-erp-backup.log 2>&1
```
Off-server copy (recommended): `apt install rclone && rclone config` (Backblaze B2 / S3 / Google Drive),
then add `RCLONE_REMOTE=b2:nex-erp-backups` to `.env`.
Test a restore once on a scratch DB so you know it works.

## 5. Access from your laptop (replaces Supabase dashboard)
```bash
ssh -L 5433:127.0.0.1:5433 root@94.136.188.176
```
Then connect DBeaver/pgAdmin/TablePlus to `localhost:5433`.

## 6. After a week of stable running
Pause or delete the Supabase project.

## Access for other developers
See [TAILSCALE.md](TAILSCALE.md) — per-person connection strings over Tailscale,
no tunnel, nothing exposed publicly.
