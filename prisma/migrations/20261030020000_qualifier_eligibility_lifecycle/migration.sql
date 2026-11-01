-- Evidence remains in place when a session is removed from operational lists.
ALTER TABLE "QualifierLobby" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "QualifierLobby" ADD COLUMN "autoCompleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QualifierScore" ADD COLUMN "eligible" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "QualifierScore" ADD COLUMN "eligibilityReason" TEXT NOT NULL DEFAULT '';
