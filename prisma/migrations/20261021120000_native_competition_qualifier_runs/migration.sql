-- Additive only: existing matches, scores, actions, and scoring settings are retained.
ALTER TABLE "TournamentStage" ADD COLUMN "qualifierPolicy" JSONB;
ALTER TABLE "QualifierLobby" ADD COLUMN "policy" JSONB, ADD COLUMN "gameplayScoring" TEXT;
ALTER TABLE "QualifierScore"
  ADD COLUMN "run" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "actualScoring" TEXT,
  ADD COLUMN "representation" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "gameId" TEXT,
  ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX "QualifierScore_lobbyId_osuId_slotName_run_key" ON "QualifierScore"("lobbyId", "osuId", "slotName", "run");
DROP INDEX "QualifierScore_lobbyId_osuId_slotName_key";
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_run_check" CHECK ("run" IN (1, 2));

CREATE TABLE "QualifierStanding" (
  "id" TEXT NOT NULL PRIMARY KEY, "tournamentId" TEXT NOT NULL, "stageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL, "published" BOOLEAN NOT NULL DEFAULT false,
  "sourceHash" TEXT NOT NULL, "snapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualifierStanding_stage_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QualifierStanding_stageId_version_key" ON "QualifierStanding"("stageId", "version");
CREATE UNIQUE INDEX "QualifierStanding_id_tournamentId_key" ON "QualifierStanding"("id", "tournamentId");

CREATE TABLE "Bracket" (
  "id" TEXT NOT NULL PRIMARY KEY, "tournamentId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "format" TEXT NOT NULL, "generationKey" TEXT NOT NULL, "config" JSONB NOT NULL, "seedOrder" JSONB NOT NULL,
  "sourceStandingId" TEXT, "published" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Bracket_tournament_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Bracket_sourceStanding_fkey" FOREIGN KEY ("sourceStandingId", "tournamentId") REFERENCES "QualifierStanding"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Bracket_format_check" CHECK ("format" IN ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'GROUPS'))
);
CREATE UNIQUE INDEX "Bracket_id_tournamentId_key" ON "Bracket"("id", "tournamentId");
CREATE UNIQUE INDEX "Bracket_tournamentId_generationKey_key" ON "Bracket"("tournamentId", "generationKey");

CREATE TABLE "BracketRound" (
  "id" TEXT NOT NULL PRIMARY KEY, "tournamentId" TEXT NOT NULL, "bracketId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL, "lane" TEXT NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "BracketRound_bracket_fkey" FOREIGN KEY ("bracketId", "tournamentId") REFERENCES "Bracket"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketRound_stage_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BracketRound_bracketId_key_key" ON "BracketRound"("bracketId", "key");
CREATE UNIQUE INDEX "BracketRound_id_bracketId_tournamentId_key" ON "BracketRound"("id", "bracketId", "tournamentId");

CREATE TABLE "BracketNode" (
  "id" TEXT NOT NULL PRIMARY KEY, "tournamentId" TEXT NOT NULL, "bracketId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL, "key" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "matchId" TEXT, "state" TEXT NOT NULL DEFAULT 'WAITING',
  CONSTRAINT "BracketNode_bracket_fkey" FOREIGN KEY ("bracketId", "tournamentId") REFERENCES "Bracket"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketNode_round_fkey" FOREIGN KEY ("roundId", "bracketId", "tournamentId") REFERENCES "BracketRound"("id", "bracketId", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketNode_match_fkey" FOREIGN KEY ("matchId", "tournamentId") REFERENCES "Match"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketNode_state_check" CHECK ("state" IN ('WAITING', 'READY', 'BYE', 'COMPLETED', 'SKIPPED'))
);
CREATE UNIQUE INDEX "BracketNode_matchId_key" ON "BracketNode"("matchId");
CREATE UNIQUE INDEX "BracketNode_id_tournamentId_key" ON "BracketNode"("id", "tournamentId");
CREATE UNIQUE INDEX "BracketNode_bracketId_key_key" ON "BracketNode"("bracketId", "key");
CREATE UNIQUE INDEX "BracketNode_matchId_tournamentId_key" ON "BracketNode"("matchId", "tournamentId");

CREATE TABLE "BracketSlot" (
  "id" TEXT NOT NULL PRIMARY KEY, "tournamentId" TEXT NOT NULL, "nodeId" TEXT NOT NULL,
  "side" "MatchSide" NOT NULL, "teamId" TEXT, "resolved" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT NOT NULL DEFAULT 'AUTO', "sourceNodeId" TEXT, "outcome" TEXT,
  CONSTRAINT "BracketSlot_node_fkey" FOREIGN KEY ("nodeId", "tournamentId") REFERENCES "BracketNode"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketSlot_team_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketSlot_sourceNode_fkey" FOREIGN KEY ("sourceNodeId", "tournamentId") REFERENCES "BracketNode"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketSlot_mode_check" CHECK ("mode" IN ('AUTO', 'MANUAL', 'LOCKED')),
  CONSTRAINT "BracketSlot_outcome_check" CHECK (("sourceNodeId" IS NULL AND "outcome" IS NULL) OR ("sourceNodeId" IS NOT NULL AND "outcome" IN ('WINNER', 'LOSER', 'RESET_A', 'RESET_B')))
);
CREATE UNIQUE INDEX "BracketSlot_nodeId_side_key" ON "BracketSlot"("nodeId", "side");
CREATE INDEX "BracketSlot_sourceNodeId_tournamentId_idx" ON "BracketSlot"("sourceNodeId", "tournamentId");

CREATE TABLE "BracketEntry" (
  "tournamentId" TEXT NOT NULL, "bracketId" TEXT NOT NULL, "teamId" TEXT NOT NULL,
  "seed" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "BracketEntry_pkey" PRIMARY KEY ("bracketId", "teamId"),
  CONSTRAINT "BracketEntry_bracket_fkey" FOREIGN KEY ("bracketId", "tournamentId") REFERENCES "Bracket"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketEntry_team_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BracketEntry_status_check" CHECK ("status" IN ('ACTIVE', 'WITHDRAWN', 'DISQUALIFIED')),
  CONSTRAINT "BracketEntry_seed_check" CHECK ("seed" > 0)
);
CREATE UNIQUE INDEX "BracketEntry_bracketId_seed_key" ON "BracketEntry"("bracketId", "seed");
