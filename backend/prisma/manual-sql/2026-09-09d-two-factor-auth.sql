-- 2026-09-09d: TOTP two-factor authentication (Google Authenticator).
--
-- Purely additive and safe to re-run: every statement is guarded, and no
-- existing column is altered or dropped.
--
-- PREREQUISITE: the TOTP secret is stored ENCRYPTED (AES-256-GCM, see
-- src/common/crypto.service.ts), and the app now REFUSES TO START without a
-- valid 64-hex-character ENCRYPTION_KEY. Deploy that env var before running
-- this, and back it up — losing it makes every enrolled authenticator
-- unrecoverable and forces a company-wide re-enrolment.

-- ── 1. Per-user TOTP enrolment ───────────────────────────────────────────────
-- Deliberately a side table rather than columns on "User": several services do
-- `include: { user: true }` and serialize the whole row to the client
-- (leaves.service.ts, payroll.service.ts), so a scalar on "User" would leak the
-- secret by default. A relation is only serialized when explicitly included.
CREATE TABLE IF NOT EXISTS "UserTwoFactor" (
  "id"               SERIAL       PRIMARY KEY,
  "userId"           INTEGER      NOT NULL,
  "secretCiphertext" TEXT         NOT NULL,
  -- NULL until the user proves possession with a valid code. Everything that
  -- asks "does this user have 2FA?" tests this, never row existence.
  "confirmedAt"      TIMESTAMP(3),
  -- Highest TOTP time step already accepted; blocks replay inside the window.
  "lastUsedStep"     INTEGER,
  "failedAttempts"   INTEGER      NOT NULL DEFAULT 0,
  "lockedUntil"      TIMESTAMP(3),
  "lastUsedAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Prisma addresses the row through this exact constraint name for the 1:1
-- relation and for upsert; renaming it breaks enrolment at runtime.
CREATE UNIQUE INDEX IF NOT EXISTS "UserTwoFactor_userId_key"
  ON "UserTwoFactor" ("userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserTwoFactor_userId_fkey') THEN
    ALTER TABLE "UserTwoFactor"
      ADD CONSTRAINT "UserTwoFactor_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. One-time recovery codes ───────────────────────────────────────────────
-- Ten per user, bcrypt-hashed, shown once. Rows survive use (usedAt set) so
-- "already used" stays distinguishable from "never existed".
CREATE TABLE IF NOT EXISTS "TwoFactorBackupCode" (
  "id"        SERIAL       PRIMARY KEY,
  "userId"    INTEGER      NOT NULL,
  "codeHash"  TEXT         NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Verification bcrypt-compares every unused code for the user; this keeps that
-- to the <= 10 rows that matter rather than a table scan.
CREATE INDEX IF NOT EXISTS "TwoFactorBackupCode_userId_usedAt_idx"
  ON "TwoFactorBackupCode" ("userId", "usedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TwoFactorBackupCode_userId_fkey') THEN
    ALTER TABLE "TwoFactorBackupCode"
      ADD CONSTRAINT "TwoFactorBackupCode_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 3. Company-wide enforcement switch ───────────────────────────────────────
-- Defaults false, so applying this migration changes nobody's login.
ALTER TABLE "SystemSetting"
  ADD COLUMN IF NOT EXISTS "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false;

-- ── 4. Self-service Security page ────────────────────────────────────────────
-- Every role gets it: MenusService adds 'settings/security' to allowedModules
-- unconditionally, beside 'employees/me/profile', so no RolePermission rows are
-- needed. displayOrder 12 puts it after Payroll Rules (11) under Settings.
INSERT INTO "Menu" ("title", "icon", "route", "displayOrder", "isActive", "parentId")
SELECT 'Security', 'shield-check', '/settings/security', 12, true, s.id
FROM "Menu" s
WHERE s.route = '/settings'
  AND NOT EXISTS (SELECT 1 FROM "Menu" m WHERE m.route = '/settings/security');

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name = 'UserTwoFactor')       AS tf_table,
  (SELECT COUNT(*) FROM information_schema.tables  WHERE table_name = 'TwoFactorBackupCode') AS bc_table,
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_name = 'SystemSetting' AND column_name = 'twoFactorRequired')               AS sys_col,
  (SELECT COUNT(*) FROM "Menu" WHERE route = '/settings/security')                           AS menu_row;
-- Expected: 1 | 1 | 1 | 1

-- ── ESCAPE HATCH ─────────────────────────────────────────────────────────────
-- Run manually on the DB console if a SUPERADMIN loses BOTH their authenticator
-- and their backup codes while twoFactorRequired is on. There is no other way
-- back in — the app deliberately offers no self-service bypass.
--
--   DELETE FROM "UserTwoFactor" WHERE "userId" =
--     (SELECT id FROM "User" WHERE email = 'admin@example.com');
--   UPDATE "SystemSetting" SET "twoFactorRequired" = false WHERE "companyId" = <id>;
