-- The reviewed workflow permanently deletes a bracket, rather than retaining a parent marker.
-- The preceding migration was already applied to the isolated verification database.
ALTER TABLE "Bracket" DROP COLUMN "deletedAt";
