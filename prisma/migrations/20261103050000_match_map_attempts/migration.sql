-- A draw or replay is not a map result: results need a winner and one per pick. These
-- record what happened on a pick so allowances can be counted and history kept.
CREATE TABLE "MatchMapAttempt" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "actionId" TEXT,
    "kind" TEXT NOT NULL,
    "side" "MatchSide",
    "osuId" INTEGER,
    "scoreA" DOUBLE PRECISION,
    "scoreB" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "beyondAllowance" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchMapAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MatchMapAttempt_kind_check" CHECK ("kind" IN ('DRAW', 'REPLAY'))
);
CREATE INDEX "MatchMapAttempt_matchId_idx" ON "MatchMapAttempt"("matchId");
ALTER TABLE "MatchMapAttempt" ADD CONSTRAINT "MatchMapAttempt_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchMapAttempt" ADD CONSTRAINT "MatchMapAttempt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "MatchMapAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchMapAttempt" ADD CONSTRAINT "MatchMapAttempt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
