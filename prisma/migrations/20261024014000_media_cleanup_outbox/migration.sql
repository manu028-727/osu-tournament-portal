-- Empty operational journal; existing catalogs and stored objects are untouched.
BEGIN;
CREATE TABLE "MediaCleanup" (
  "key" TEXT PRIMARY KEY,
  "state" TEXT NOT NULL DEFAULT 'UPLOADING',
  "readyAfter" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaCleanup_state_check" CHECK ("state" IN ('UPLOADING', 'PENDING', 'CLEANING'))
);
CREATE INDEX "MediaCleanup_readyAfter_idx" ON "MediaCleanup"("readyAfter");
COMMIT;
