ALTER TABLE "Tournament"
ADD COLUMN "matchNumberSequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Match"
ADD COLUMN "matchNumber" INTEGER NOT NULL DEFAULT 0;

-- Keep unambiguous numeric source codes. Colliding numeric spellings (for example, "01" and
-- "1") are assigned new numbers below; their original codes remain unchanged.
WITH numeric_codes AS (
  SELECT
    "id",
    "tournamentId",
    "code"::NUMERIC AS number,
    COUNT(*) OVER (PARTITION BY "tournamentId", "code"::NUMERIC) AS duplicates
  FROM "Match"
  WHERE "code" ~ '^[0-9]{1,10}$'
    AND "code"::NUMERIC BETWEEN 1 AND 2147483647
)
UPDATE "Match" AS match
SET "matchNumber" = numeric_codes.number::INTEGER
FROM numeric_codes
WHERE match."id" = numeric_codes."id"
  AND numeric_codes.duplicates = 1;

-- Give all other historical matches a stable number in creation order without changing their
-- internal IDs, codes, histories, or results.
WITH bases AS (
  SELECT "tournamentId", COALESCE(MAX("matchNumber"), 0) AS base
  FROM "Match"
  GROUP BY "tournamentId"
), numbered AS (
  SELECT
    match."id",
    bases.base + ROW_NUMBER() OVER (
      PARTITION BY match."tournamentId"
      ORDER BY match."createdAt", match."id"
    ) AS number
  FROM "Match" AS match
  JOIN bases USING ("tournamentId")
  WHERE match."matchNumber" = 0
)
UPDATE "Match" AS match
SET "matchNumber" = numbered.number::INTEGER
FROM numbered
WHERE match."id" = numbered."id";

ALTER TABLE "Match"
ADD CONSTRAINT "Match_matchNumber_positive_check" CHECK ("matchNumber" > 0);

CREATE UNIQUE INDEX "Match_tournamentId_matchNumber_key"
ON "Match"("tournamentId", "matchNumber");

UPDATE "Tournament" AS tournament
SET "matchNumberSequence" = COALESCE(
  (SELECT MAX("matchNumber") FROM "Match" WHERE "tournamentId" = tournament."id"),
  0
);

ALTER TABLE "BracketNode"
ADD COLUMN "matchNumber" INTEGER;

-- Existing materialized bracket matches keep the number assigned during the match backfill.
UPDATE "BracketNode" AS node
SET "matchNumber" = match."matchNumber"
FROM "Match" AS match
WHERE node."matchId" = match."id"
  AND node."tournamentId" = match."tournamentId";

-- Reserve numbers for the remaining match-capable nodes of existing brackets. This preserves
-- the same round/top-to-bottom order used for newly generated brackets.
WITH bases AS (
  SELECT "id" AS "tournamentId", "matchNumberSequence" AS base
  FROM "Tournament"
), numbered AS (
  SELECT
    node."id",
    bases.base + ROW_NUMBER() OVER (
      PARTITION BY node."tournamentId"
      ORDER BY bracket."createdAt", bracket."id", round."position", round."lane",
               node."position", node."key", node."id"
    ) AS number
  FROM "BracketNode" AS node
  JOIN "Bracket" AS bracket
    ON bracket."id" = node."bracketId"
   AND bracket."tournamentId" = node."tournamentId"
  JOIN "BracketRound" AS round
    ON round."id" = node."roundId"
   AND round."bracketId" = node."bracketId"
   AND round."tournamentId" = node."tournamentId"
  JOIN bases ON bases."tournamentId" = node."tournamentId"
  WHERE node."matchId" IS NULL
    AND node."matchNumber" IS NULL
    AND node."state" NOT IN ('BYE', 'SKIPPED')
)
UPDATE "BracketNode" AS node
SET "matchNumber" = numbered.number::INTEGER
FROM numbered
WHERE node."id" = numbered."id";

CREATE UNIQUE INDEX "BracketNode_tournamentId_matchNumber_key"
ON "BracketNode"("tournamentId", "matchNumber");

UPDATE "Tournament" AS tournament
SET "matchNumberSequence" = GREATEST(
  COALESCE((SELECT MAX("matchNumber") FROM "Match" WHERE "tournamentId" = tournament."id"), 0),
  COALESCE((SELECT MAX("matchNumber") FROM "BracketNode" WHERE "tournamentId" = tournament."id"), 0)
);

CREATE OR REPLACE FUNCTION assign_tournament_match_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."matchNumber" IS NULL OR NEW."matchNumber" = 0 THEN
    UPDATE "Tournament"
    SET "matchNumberSequence" = "matchNumberSequence" + 1
    WHERE "id" = NEW."tournamentId"
    RETURNING "matchNumberSequence" INTO NEW."matchNumber";
  ELSE
    UPDATE "Tournament"
    SET "matchNumberSequence" = GREATEST("matchNumberSequence", NEW."matchNumber")
    WHERE "id" = NEW."tournamentId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Match_assign_tournament_match_number"
BEFORE INSERT ON "Match"
FOR EACH ROW
EXECUTE FUNCTION assign_tournament_match_number();

CREATE OR REPLACE FUNCTION keep_tournament_match_number_stable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."matchNumber" IS DISTINCT FROM OLD."matchNumber" THEN
    RAISE EXCEPTION 'Tournament match numbers cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Match_match_number_immutable"
BEFORE UPDATE OF "matchNumber" ON "Match"
FOR EACH ROW
EXECUTE FUNCTION keep_tournament_match_number_stable();

CREATE TRIGGER "BracketNode_match_number_immutable"
BEFORE UPDATE OF "matchNumber" ON "BracketNode"
FOR EACH ROW
WHEN (OLD."matchNumber" IS NOT NULL)
EXECUTE FUNCTION keep_tournament_match_number_stable();
