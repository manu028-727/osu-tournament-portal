-- A tournament's reviewed progression, and any setup input that is not yet valid enough
-- to save into its real record. Both are additive and empty for existing tournaments.
CREATE TABLE "TournamentPhase" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stageId" TEXT,
    "config" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PLANNED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TournamentPhase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TournamentPhase_kind_check" CHECK ("kind" IN ('QUALIFIER', 'TEAM_FORMATION', 'GROUPS', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION')),
    CONSTRAINT "TournamentPhase_state_check" CHECK ("state" IN ('PLANNED', 'LOCKED', 'ACTIVE', 'COMPLETE'))
);
CREATE UNIQUE INDEX "TournamentPhase_id_tournamentId_key" ON "TournamentPhase"("id", "tournamentId");
CREATE UNIQUE INDEX "TournamentPhase_tournamentId_key_key" ON "TournamentPhase"("tournamentId", "key");
CREATE INDEX "TournamentPhase_stageId_tournamentId_idx" ON "TournamentPhase"("stageId", "tournamentId");
ALTER TABLE "TournamentPhase" ADD CONSTRAINT "TournamentPhase_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPhase" ADD CONSTRAINT "TournamentPhase_stage_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TournamentSettings" ADD COLUMN "setupState" JSONB;
