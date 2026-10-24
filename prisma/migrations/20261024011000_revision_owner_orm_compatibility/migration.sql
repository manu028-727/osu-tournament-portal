-- Optional pointer relations sharing the owner's primary key make Prisma nested
-- creates null that key. Retain tenant FKs and enforce owner equality in triggers.
-- Preserve the applied test ledger; never rewrite/repair historical records.
BEGIN;
ALTER TABLE "Page" DROP CONSTRAINT "Page_draftRevisionId_id_tournamentId_fkey", DROP CONSTRAINT "Page_publishedRevisionId_id_tournamentId_fkey",
  ADD CONSTRAINT "Page_draftRevisionId_tournamentId_fkey" FOREIGN KEY ("draftRevisionId", "tournamentId") REFERENCES "PageRevision"(id, "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Page_publishedRevisionId_tournamentId_fkey" FOREIGN KEY ("publishedRevisionId", "tournamentId") REFERENCES "PageRevision"(id, "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Mappool" DROP CONSTRAINT "Mappool_draftRevisionId_id_tournamentId_fkey", DROP CONSTRAINT "Mappool_publishedRevisionId_id_tournamentId_fkey",
  ADD CONSTRAINT "Mappool_draftRevisionId_tournamentId_fkey" FOREIGN KEY ("draftRevisionId", "tournamentId") REFERENCES "MappoolRevision"(id, "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Mappool_publishedRevisionId_tournamentId_fkey" FOREIGN KEY ("publishedRevisionId", "tournamentId") REFERENCES "MappoolRevision"(id, "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;
DROP INDEX "Page_draftRevisionId_id_tournamentId_key", "Page_publishedRevisionId_id_tournamentId_key",
  "Mappool_draftRevisionId_id_tournamentId_key", "Mappool_publishedRevisionId_id_tournamentId_key",
  "PageRevision_id_pageId_tournamentId_key", "MappoolRevision_id_mappoolId_tournamentId_key";
CREATE FUNCTION check_page_revision_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Page' THEN
    IF EXISTS (SELECT 1 FROM "PageRevision" r WHERE r.id IN (NEW."draftRevisionId", NEW."publishedRevisionId") AND r."pageId" <> NEW.id) THEN
      RAISE EXCEPTION 'Revision belongs to another page' USING ERRCODE = '23503', CONSTRAINT = 'Page_revision_owner';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Page" p WHERE NEW.id IN (p."draftRevisionId", p."publishedRevisionId") AND p.id <> NEW."pageId") THEN
      RAISE EXCEPTION 'Revision is referenced by another page' USING ERRCODE = '23503', CONSTRAINT = 'Page_revision_owner';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Page_revision_owner" AFTER INSERT OR UPDATE ON "Page" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_page_revision_owner();
CREATE CONSTRAINT TRIGGER "PageRevision_owner" AFTER UPDATE ON "PageRevision" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_page_revision_owner();
CREATE FUNCTION check_pool_revision_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Mappool' THEN
    IF EXISTS (SELECT 1 FROM "MappoolRevision" r WHERE r.id IN (NEW."draftRevisionId", NEW."publishedRevisionId") AND r."mappoolId" <> NEW.id) THEN
      RAISE EXCEPTION 'Revision belongs to another pool' USING ERRCODE = '23503', CONSTRAINT = 'Mappool_revision_owner';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "Mappool" p WHERE NEW.id IN (p."draftRevisionId", p."publishedRevisionId") AND p.id <> NEW."mappoolId") THEN
      RAISE EXCEPTION 'Revision is referenced by another pool' USING ERRCODE = '23503', CONSTRAINT = 'Mappool_revision_owner';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Mappool_revision_owner" AFTER INSERT OR UPDATE ON "Mappool" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_pool_revision_owner();
CREATE CONSTRAINT TRIGGER "MappoolRevision_owner" AFTER UPDATE ON "MappoolRevision" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_pool_revision_owner();
COMMIT;
