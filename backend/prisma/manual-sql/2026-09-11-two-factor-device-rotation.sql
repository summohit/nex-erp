-- 2026-09-11: Moving an authenticator to a new device
--
-- Until now "I got a new phone" had no route. disable() refuses while the
-- company requires 2FA, startEnrolment() refuses while confirmedAt is set, and
-- adminReset() refuses to reset the caller's own account — so a company with a
-- single SUPERADMIN had no path at all short of hand-written SQL.
--
-- The fix is a rotation: prove the current factor (password + a live code or a
-- backup code), receive a new secret, and confirm it from the new device. The
-- replacement is parked in pendingSecretCiphertext rather than overwriting the
-- live one, so the OLD device keeps working until the new one proves itself.
-- Abandon the move and nothing changed; 2FA never lapses, and the company
-- policy is never weakened.
--
-- Additive and re-runnable, applied alongside `prisma db push`.

ALTER TABLE "UserTwoFactor"
  ADD COLUMN IF NOT EXISTS "pendingSecretCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingStartedAt"        TIMESTAMP(3);

-- Verify: both checks should return 1.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'UserTwoFactor' AND column_name = 'pendingSecretCiphertext') AS pending_secret,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'UserTwoFactor' AND column_name = 'pendingStartedAt')        AS pending_started;
