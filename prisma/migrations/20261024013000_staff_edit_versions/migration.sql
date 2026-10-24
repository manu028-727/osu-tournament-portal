-- Existing rows begin at version one; no authored content or history changes.
BEGIN;
ALTER TABLE "StaffMember" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StaffCategory" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ModCategory" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
COMMIT;
