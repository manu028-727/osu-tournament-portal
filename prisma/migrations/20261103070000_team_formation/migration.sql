-- Turning individual qualifier players into teams. Until confirmation the board only
-- records decisions, so rosters stay as they are and every sale can still be undone.
CREATE TABLE "FormationSession" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "rosterSize" INTEGER NOT NULL,
    "teamSeeding" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "randomSeed" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormationSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FormationSession_method_check" CHECK ("method" IN ('AUCTION', 'SNAKE_DRAFT', 'MANUAL')),
    CONSTRAINT "FormationSession_state_check" CHECK ("state" IN ('OPEN', 'CONFIRMED'))
);
CREATE UNIQUE INDEX "FormationSession_phaseId_key" ON "FormationSession"("phaseId");
CREATE UNIQUE INDEX "FormationSession_id_tournamentId_key" ON "FormationSession"("id", "tournamentId");
CREATE UNIQUE INDEX "FormationSession_phaseId_tournamentId_key" ON "FormationSession"("phaseId", "tournamentId");
ALTER TABLE "FormationSession" ADD CONSTRAINT "FormationSession_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormationSession" ADD CONSTRAINT "FormationSession_phaseId_tournamentId_fkey" FOREIGN KEY ("phaseId", "tournamentId") REFERENCES "TournamentPhase"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FormationTeam" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "budget" INTEGER,
    "teamId" TEXT,
    CONSTRAINT "FormationTeam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FormationTeam_id_tournamentId_key" ON "FormationTeam"("id", "tournamentId");
CREATE UNIQUE INDEX "FormationTeam_sessionId_position_key" ON "FormationTeam"("sessionId", "position");
CREATE UNIQUE INDEX "FormationTeam_teamId_key" ON "FormationTeam"("teamId");
CREATE UNIQUE INDEX "FormationTeam_teamId_tournamentId_key" ON "FormationTeam"("teamId", "tournamentId");
ALTER TABLE "FormationTeam" ADD CONSTRAINT "FormationTeam_sessionId_tournamentId_fkey" FOREIGN KEY ("sessionId", "tournamentId") REFERENCES "FormationSession"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormationTeam" ADD CONSTRAINT "FormationTeam_teamId_tournamentId_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FormationLot" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceTeamId" TEXT NOT NULL,
    "sourcePublished" BOOLEAN NOT NULL,
    "osuId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "seed" INTEGER,
    "position" INTEGER NOT NULL,
    "captain" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'WAITING',
    "formationTeamId" TEXT,
    "price" INTEGER,
    "filled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "FormationLot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FormationLot_state_check" CHECK ("state" IN ('WAITING', 'SOLD', 'RESERVE')),
    CONSTRAINT "FormationLot_sold_check" CHECK (("state" = 'SOLD') = ("formationTeamId" IS NOT NULL)),
    CONSTRAINT "FormationLot_price_check" CHECK ("price" IS NULL OR "price" >= 0)
);
CREATE UNIQUE INDEX "FormationLot_sessionId_osuId_key" ON "FormationLot"("sessionId", "osuId");
CREATE UNIQUE INDEX "FormationLot_sessionId_position_key" ON "FormationLot"("sessionId", "position");
CREATE INDEX "FormationLot_sourceTeamId_idx" ON "FormationLot"("sourceTeamId");
ALTER TABLE "FormationLot" ADD CONSTRAINT "FormationLot_sessionId_tournamentId_fkey" FOREIGN KEY ("sessionId", "tournamentId") REFERENCES "FormationSession"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormationLot" ADD CONSTRAINT "FormationLot_sourceTeamId_tournamentId_fkey" FOREIGN KEY ("sourceTeamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormationLot" ADD CONSTRAINT "FormationLot_formationTeamId_tournamentId_fkey" FOREIGN KEY ("formationTeamId", "tournamentId") REFERENCES "FormationTeam"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only history of the board. Reasons here are private to organizers.
CREATE TABLE "FormationEvent" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FormationEvent_sessionId_sequence_key" ON "FormationEvent"("sessionId", "sequence");
ALTER TABLE "FormationEvent" ADD CONSTRAINT "FormationEvent_sessionId_tournamentId_fkey" FOREIGN KEY ("sessionId", "tournamentId") REFERENCES "FormationSession"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormationEvent" ADD CONSTRAINT "FormationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
