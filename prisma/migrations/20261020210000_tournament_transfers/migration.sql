CREATE TABLE "TournamentTransfer" (
    "id" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "tournamentId" TEXT,
    "status" TEXT NOT NULL,
    "objectKeys" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TournamentTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TournamentTransfer_initiatedBy_createdAt_idx" ON "TournamentTransfer"("initiatedBy", "createdAt");
CREATE INDEX "TournamentTransfer_status_createdAt_idx" ON "TournamentTransfer"("status", "createdAt");
