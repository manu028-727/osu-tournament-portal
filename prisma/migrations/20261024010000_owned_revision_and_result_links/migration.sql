-- Stop for reviewed repair rather than rewriting any historical relationship.
-- One transaction keeps scans, indexes and constraint replacement atomic.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Page" p JOIN "PageRevision" r
      ON r.id IN (p."draftRevisionId", p."publishedRevisionId")
    WHERE r."pageId" <> p.id OR r."tournamentId" <> p."tournamentId"
  ) OR EXISTS (
    SELECT 1 FROM "Mappool" p JOIN "MappoolRevision" r
      ON r.id IN (p."draftRevisionId", p."publishedRevisionId")
    WHERE r."mappoolId" <> p.id OR r."tournamentId" <> p."tournamentId"
  ) OR EXISTS (
    SELECT 1 FROM "MatchMapResult" r JOIN "MatchMapAction" a ON a.id = r."actionId"
    WHERE a."matchId" <> r."matchId"
  ) OR EXISTS (
    SELECT 1 FROM "MultiplayerGame" g LEFT JOIN "MatchMapAction" a ON a.id = g."actionId"
    WHERE g."actionId" IS NOT NULL AND (a.id IS NULL OR a."matchId" <> g."matchId")
  ) THEN
    RAISE EXCEPTION 'Ownership mismatch detected. Review revision pointers and result/evidence action links before retrying; no history was changed.';
  END IF;
END $$;

CREATE UNIQUE INDEX "PageRevision_id_pageId_tournamentId_key" ON "PageRevision"(id, "pageId", "tournamentId");
CREATE UNIQUE INDEX "MappoolRevision_id_mappoolId_tournamentId_key" ON "MappoolRevision"(id, "mappoolId", "tournamentId");
CREATE UNIQUE INDEX "MatchMapAction_id_matchId_key" ON "MatchMapAction"(id, "matchId");
CREATE UNIQUE INDEX "Page_draftRevisionId_id_tournamentId_key" ON "Page"("draftRevisionId", id, "tournamentId");
CREATE UNIQUE INDEX "Page_publishedRevisionId_id_tournamentId_key" ON "Page"("publishedRevisionId", id, "tournamentId");
CREATE UNIQUE INDEX "Mappool_draftRevisionId_id_tournamentId_key" ON "Mappool"("draftRevisionId", id, "tournamentId");
CREATE UNIQUE INDEX "Mappool_publishedRevisionId_id_tournamentId_key" ON "Mappool"("publishedRevisionId", id, "tournamentId");
CREATE UNIQUE INDEX "MatchMapResult_actionId_matchId_key" ON "MatchMapResult"("actionId", "matchId");

ALTER TABLE "Page" DROP CONSTRAINT "Page_draftRevisionId_tournamentId_fkey",
  DROP CONSTRAINT "Page_publishedRevisionId_tournamentId_fkey",
  ADD CONSTRAINT "Page_draftRevisionId_id_tournamentId_fkey" FOREIGN KEY ("draftRevisionId", id, "tournamentId") REFERENCES "PageRevision"(id, "pageId", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Page_publishedRevisionId_id_tournamentId_fkey" FOREIGN KEY ("publishedRevisionId", id, "tournamentId") REFERENCES "PageRevision"(id, "pageId", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Mappool" DROP CONSTRAINT "Mappool_draftRevisionId_tournamentId_fkey",
  DROP CONSTRAINT "Mappool_publishedRevisionId_tournamentId_fkey",
  ADD CONSTRAINT "Mappool_draftRevisionId_id_tournamentId_fkey" FOREIGN KEY ("draftRevisionId", id, "tournamentId") REFERENCES "MappoolRevision"(id, "mappoolId", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Mappool_publishedRevisionId_id_tournamentId_fkey" FOREIGN KEY ("publishedRevisionId", id, "tournamentId") REFERENCES "MappoolRevision"(id, "mappoolId", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "MatchMapResult" DROP CONSTRAINT "MatchMapResult_actionId_fkey",
  ADD CONSTRAINT "MatchMapResult_actionId_matchId_fkey" FOREIGN KEY ("actionId", "matchId") REFERENCES "MatchMapAction"(id, "matchId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MultiplayerGame" ADD CONSTRAINT "MultiplayerGame_actionId_matchId_fkey" FOREIGN KEY ("actionId", "matchId") REFERENCES "MatchMapAction"(id, "matchId") ON DELETE NO ACTION ON UPDATE CASCADE;
COMMIT;
