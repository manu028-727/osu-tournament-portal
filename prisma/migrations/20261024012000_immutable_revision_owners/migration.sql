-- Saved revision identities and owners never move. This also prevents a
-- concurrent owner update from racing the pointer constraint triggers.
BEGIN;
CREATE FUNCTION immutable_revision_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."tournamentId" IS DISTINCT FROM OLD."tournamentId"
     OR to_jsonb(NEW)->TG_ARGV[0] IS DISTINCT FROM to_jsonb(OLD)->TG_ARGV[0] THEN
    RAISE EXCEPTION 'Saved revision ownership is immutable' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PageRevision_immutable_owner" BEFORE UPDATE ON "PageRevision" FOR EACH ROW EXECUTE FUNCTION immutable_revision_owner('pageId');
CREATE TRIGGER "MappoolRevision_immutable_owner" BEFORE UPDATE ON "MappoolRevision" FOR EACH ROW EXECUTE FUNCTION immutable_revision_owner('mappoolId');
COMMIT;
