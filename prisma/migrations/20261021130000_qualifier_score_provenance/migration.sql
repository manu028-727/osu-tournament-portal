-- Add provenance only; raw/adjusted values and historical rule JSON are untouched.
UPDATE "QualifierScore" AS score
SET "actualScoring" = CASE
  WHEN lobby.rules->>'gameplayScoring' IN ('SCORE_V1','SCORE_V2','LAZER') THEN lobby.rules->>'gameplayScoring'
  WHEN lobby.rules->>'scoreMode' = 'SCORE' THEN 'SCORE_V1'
  WHEN lobby.rules->>'scoreMode' = 'SCORE_V2' THEN 'SCORE_V2'
END
FROM "QualifierLobby" AS lobby WHERE score."lobbyId" = lobby.id AND score."actualScoring" IS NULL;
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_scoring_check"
CHECK ("actualScoring" IS NULL OR "actualScoring" IN ('SCORE_V1','SCORE_V2','LAZER'));
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_representation_check"
CHECK (representation IN ('LEGACY','STANDARDIZED'));
