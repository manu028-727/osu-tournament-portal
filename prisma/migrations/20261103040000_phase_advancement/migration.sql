-- Locked phases own a bracket, whose slots can wait for entrants by name. Every applied
-- advancement is kept with the source witness it was reviewed against. All additive:
-- existing brackets have no phase and read every new column as null.
ALTER TABLE "TournamentPhase" ADD COLUMN "bracketId" TEXT;
CREATE UNIQUE INDEX "TournamentPhase_bracketId_tournamentId_key" ON "TournamentPhase"("bracketId", "tournamentId");
ALTER TABLE "TournamentPhase" ADD CONSTRAINT "TournamentPhase_bracket_fkey" FOREIGN KEY ("bracketId", "tournamentId") REFERENCES "Bracket"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BracketSlot" ADD COLUMN "entryRef" TEXT;
ALTER TABLE "BracketSlot" ADD COLUMN "entryLabel" TEXT;

ALTER TABLE "BracketEntry" ADD COLUMN "groupIndex" INTEGER;
ALTER TABLE "BracketEntry" ADD COLUMN "pot" INTEGER;
ALTER TABLE "BracketEntry" ADD COLUMN "tier" TEXT;
ALTER TABLE "BracketEntry" ADD COLUMN "entryLane" TEXT;
ALTER TABLE "BracketEntry" ADD COLUMN "lossesAllowed" INTEGER;
ALTER TABLE "BracketEntry" ADD COLUMN "provenance" TEXT;

CREATE TABLE "PhaseAdvancement" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "assignment" JSONB NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhaseAdvancement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PhaseAdvancement_kind_check" CHECK ("kind" IN ('ENTRIES', 'RESEED'))
);
CREATE UNIQUE INDEX "PhaseAdvancement_phaseId_revision_key" ON "PhaseAdvancement"("phaseId", "revision");
CREATE INDEX "PhaseAdvancement_tournamentId_idx" ON "PhaseAdvancement"("tournamentId");
ALTER TABLE "PhaseAdvancement" ADD CONSTRAINT "PhaseAdvancement_phase_fkey" FOREIGN KEY ("phaseId", "tournamentId") REFERENCES "TournamentPhase"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhaseAdvancement" ADD CONSTRAINT "PhaseAdvancement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A solo qualifier entrant replaced by a formed team keeps its history and leaves play.
ALTER TABLE "Team" ADD COLUMN "supersededAt" TIMESTAMP(3);
