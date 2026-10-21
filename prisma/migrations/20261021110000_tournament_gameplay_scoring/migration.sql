ALTER TABLE "TournamentSettings" ADD COLUMN "gameplayScoring" TEXT;

-- Infer only unanimous legacy scoring. Keep conflicts unresolved for review;
-- never update historical rule snapshots or convert numerical scores.
WITH modes AS (
  SELECT "tournamentId", "matchRules"->>'scoreMode' AS mode FROM "TournamentSettings"
  UNION ALL
  SELECT "tournamentId", "matchRules"->>'scoreMode' FROM "TournamentStage"
  UNION ALL
  SELECT "tournamentId", rules->>'scoreMode' FROM "Match"
  UNION ALL
  SELECT "tournamentId", rules->>'scoreMode' FROM "QualifierLobby"
), consensus AS (
  SELECT "tournamentId", min(mode) AS mode, count(DISTINCT mode) AS variants
  FROM modes WHERE mode IS NOT NULL GROUP BY "tournamentId"
)
UPDATE "TournamentSettings" AS settings
SET "gameplayScoring" = CASE consensus.mode WHEN 'SCORE' THEN 'SCORE_V1' WHEN 'SCORE_V2' THEN 'SCORE_V2' END
FROM consensus WHERE settings."tournamentId" = consensus."tournamentId" AND consensus.variants = 1;

-- Empty installations have no contradictory competitive history.
UPDATE "TournamentSettings" AS settings SET "gameplayScoring" = 'SCORE_V2'
WHERE "gameplayScoring" IS NULL AND NOT EXISTS (
  SELECT 1 FROM "Match" WHERE "tournamentId" = settings."tournamentId"
) AND NOT EXISTS (
  SELECT 1 FROM "QualifierLobby" WHERE "tournamentId" = settings."tournamentId"
) AND NOT EXISTS (
  SELECT 1 FROM "TournamentStage" WHERE "tournamentId" = settings."tournamentId"
  AND "matchRules"->>'scoreMode' IS NOT NULL
) AND settings."matchRules"->>'scoreMode' IS NULL;

ALTER TABLE "TournamentSettings" ADD CONSTRAINT "TournamentSettings_gameplayScoring_check"
CHECK ("gameplayScoring" IS NULL OR "gameplayScoring" IN ('SCORE_V1', 'SCORE_V2', 'LAZER'));
