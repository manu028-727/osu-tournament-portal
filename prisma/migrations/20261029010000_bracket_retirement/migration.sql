-- Keep the complete graph and its played records as an immutable historical witness.
ALTER TABLE "Bracket" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- A retired fixture must not reserve an active fixture's schedule.
DROP INDEX "Match_stageId_teamAId_teamBId_scheduledAt_key";
CREATE INDEX "Match_stageId_teamAId_teamBId_scheduledAt_idx"
  ON "Match" ("stageId", "teamAId", "teamBId", "scheduledAt");
CREATE UNIQUE INDEX "Match_active_pair_schedule_key"
  ON "Match" ("stageId", "teamAId", "teamBId", "scheduledAt")
  WHERE "deletedAt" IS NULL;
