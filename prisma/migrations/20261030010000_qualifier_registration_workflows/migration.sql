-- Additive: existing sessions, registrations, referee histories and room requests are retained.
ALTER TABLE "TournamentSettings" ADD COLUMN "registrationPolicy" JSONB;
ALTER TABLE "Team" ADD COLUMN "rejectionReason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "adminNotes" TEXT NOT NULL DEFAULT '', ADD COLUMN "registrationAnswers" JSONB;
ALTER TABLE "QualifierLobby" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 16,
  ADD COLUMN "bookingOpen" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "bookingClosesAt" TIMESTAMP(3),
  ADD COLUMN "multiplayerSyncedAt" TIMESTAMP(3), ADD COLUMN "multiplayerError" TEXT, ADD COLUMN "multiplayerSync" JSONB,
  ADD CONSTRAINT "QualifierLobby_capacity_check" CHECK ("capacity" BETWEEN 1 AND 16);
CREATE TABLE "QualifierGame" (
  "id" TEXT NOT NULL PRIMARY KEY, "lobbyId" TEXT NOT NULL,
  "multiplayerId" INTEGER NOT NULL CHECK ("multiplayerId" > 0), "gameId" TEXT NOT NULL,
  "run" INTEGER CHECK ("run" IN (1, 2)), "slotName" TEXT, "startedAt" TIMESTAMP(3),
  "evidence" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL DEFAULT '', "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QualifierGame_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "QualifierLobby"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QualifierGame_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'IGNORED'))
);
CREATE UNIQUE INDEX "QualifierGame_lobbyId_multiplayerId_gameId_key" ON "QualifierGame"("lobbyId", "multiplayerId", "gameId");
ALTER TABLE "IrcLobbyRequest" ALTER COLUMN "matchId" DROP NOT NULL,
  ADD COLUMN "qualifierLobbyId" TEXT,
  ADD CONSTRAINT "IrcLobbyRequest_qualifierLobbyId_tournamentId_fkey" FOREIGN KEY ("qualifierLobbyId", "tournamentId") REFERENCES "QualifierLobby"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "IrcLobbyRequest_one_context_check" CHECK (("matchId" IS NOT NULL)::int + ("qualifierLobbyId" IS NOT NULL)::int = 1);
CREATE INDEX "IrcLobbyRequest_qualifierLobbyId_createdAt_idx" ON "IrcLobbyRequest"("qualifierLobbyId", "createdAt");
