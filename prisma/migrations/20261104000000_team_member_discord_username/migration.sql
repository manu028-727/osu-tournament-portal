-- Rosters now collect a Discord username. "discordId" keeps what rosters saved earlier hold,
-- because a numeric ID cannot be turned into a username, until a username replaces it.
ALTER TABLE "TeamMember" ADD COLUMN "discordUsername" TEXT NOT NULL DEFAULT '';
