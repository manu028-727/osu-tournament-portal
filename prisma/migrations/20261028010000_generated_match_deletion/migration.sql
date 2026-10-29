-- Preserve generated match records and their immutable bracket reservations.
ALTER TABLE "Match" ADD COLUMN "deletedAt" TIMESTAMP(3);
