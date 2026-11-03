-- When a recorded rank was read, so a rank lock can tell old readings from locked ones.
ALTER TABLE "TeamMember" ADD COLUMN "rankCapturedAt" TIMESTAMP(3);

-- An organizer's decision to admit a player the written limits would refuse, such as
-- after an interview. One row per player and limit; the audit log keeps every change.
CREATE TABLE "EligibilityException" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "osuId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedReason" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "EligibilityException_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EligibilityException_kind_check" CHECK ("kind" IN ('RANK', 'COUNTRY', 'RANK_SUM'))
);
CREATE UNIQUE INDEX "EligibilityException_tournamentId_osuId_kind_key" ON "EligibilityException"("tournamentId", "osuId", "kind");
ALTER TABLE "EligibilityException" ADD CONSTRAINT "EligibilityException_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EligibilityException" ADD CONSTRAINT "EligibilityException_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EligibilityException" ADD CONSTRAINT "EligibilityException_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
