// Serialize capacity-changing writes per company so concurrent onboarding completions
// cannot both observe an unfilled posting. Call within the same transaction as the write.
export async function lockJobCapacity(tx: any, companyId: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(74123, ${companyId})`;
}

// Applications have no employee foreign key. The existing conversion flow creates
// the employee user with the application email; count distinct employees to avoid
// counting duplicate applications for the same person twice.
export async function closeFilledJobs(tx: any, companyId: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Job" j SET "status" = 'Closed', "updatedAt" = NOW()
    WHERE j."companyId" = ${companyId} AND j."status" = 'Open' AND j."totalOpenings" > 0
      AND (SELECT COUNT(DISTINCT e."id") FROM "JobApplication" a
        JOIN "User" u ON lower(u."email") = lower(a."email") AND u."companyId" = a."companyId"
        JOIN "Employee" e ON e."userId" = u."id" AND e."companyId" = a."companyId"
        WHERE a."jobId" = j."id" AND a."companyId" = j."companyId"
          AND a."status" = 'ONBOARDED' AND e."onboardingStatus" = 'COMPLETED') >= j."totalOpenings"`;
}
