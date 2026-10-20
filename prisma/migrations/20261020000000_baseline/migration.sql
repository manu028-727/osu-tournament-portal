-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PublicationState" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeamFormat" AS ENUM ('TEAM', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatchSide" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "MapActionKind" AS ENUM ('PROTECT', 'BAN', 'PICK');

-- CreateEnum
CREATE TYPE "MatchResultMode" AS ENUM ('MAPS', 'SUMMARY');

-- CreateTable
CREATE TABLE "User" (
    "platformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "osuId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "country" TEXT,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "returnTo" TEXT NOT NULL DEFAULT '/',

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Role" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "templateKey" TEXT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "slug" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "format" TEXT NOT NULL DEFAULT 'CUSTOM',
    "archivedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "id" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL,
    "acronym" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTRATIONS_OPEN',
    "gameMode" TEXT NOT NULL DEFAULT 'osu',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentSettings" (
    "tournamentId" TEXT NOT NULL,
    "logo" TEXT NOT NULL DEFAULT '',
    "favicon" TEXT NOT NULL DEFAULT '',
    "banner" TEXT NOT NULL DEFAULT '/artwork.svg',
    "primaryColor" TEXT NOT NULL DEFAULT '#e89caa',
    "accentColor" TEXT NOT NULL DEFAULT '#b6a0e5',
    "registrationUrl" TEXT NOT NULL DEFAULT 'https://osu.ppy.sh/community/forums/55',
    "socialLinks" JSONB NOT NULL,
    "importantDates" JSONB NOT NULL,
    "navigation" JSONB NOT NULL,
    "footer" TEXT NOT NULL,
    "copy" JSONB NOT NULL DEFAULT '{}',
    "matchRules" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentSettings_pkey" PRIMARY KEY ("tournamentId")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" "PublicationState" NOT NULL DEFAULT 'DRAFT',
    "draftRevisionId" TEXT,
    "publishedRevisionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageRevision" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "content" JSONB NOT NULL,

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStage" (
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "archivedAt" TIMESTAMP(3),
    "nextStageId" TEXT,
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "bannerImageId" TEXT,
    "matchRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModCategory" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL,
    "acronym" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ModCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mappool" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "state" "PublicationState" NOT NULL DEFAULT 'DRAFT',
    "draftRevisionId" TEXT,
    "publishedRevisionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mappool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappoolRevision" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "id" TEXT NOT NULL,
    "mappoolId" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappoolRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappoolSlot" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "categoryPriority" INTEGER,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "beatmapId" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "MappoolSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beatmap" (
    "id" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Beatmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "id" TEXT NOT NULL,
    "osuId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "profileUrl" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "customImage" TEXT NOT NULL DEFAULT '',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCategory" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StaffCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAssignment" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "memberId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("memberId","categoryId")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "osuId" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "country" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("osuId")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "format" "TeamFormat" NOT NULL DEFAULT 'TEAM',
    "logoImageId" TEXT,
    "seed" INTEGER,
    "rankSum" INTEGER,
    "qualifierPlayed" BOOLEAN,
    "sourceKey" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "teamId" TEXT NOT NULL,
    "osuId" INTEGER NOT NULL,
    "captain" BOOLEAN NOT NULL DEFAULT false,
    "substitute" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "registrationRank" INTEGER,
    "registeredUsername" TEXT,
    "discordId" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","osuId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "tournamentId" TEXT DEFAULT 'main',
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualifierLobby" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "poolRevisionId" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "participants" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "lobbyUrl" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualifierLobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualifierEntry" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "lobbyId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QualifierEntry_pkey" PRIMARY KEY ("lobbyId","teamId")
);

-- CreateTable
CREATE TABLE "QualifierAssignment" (
    "lobbyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "QualifierAssignment_pkey" PRIMARY KEY ("lobbyId","userId")
);

-- CreateTable
CREATE TABLE "QualifierScore" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "osuId" INTEGER NOT NULL,
    "slotName" TEXT NOT NULL,
    "raw" DOUBLE PRECISION NOT NULL,
    "mods" JSONB NOT NULL,
    "adjusted" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualifierScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualifierEvent" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "actorId" TEXT,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualifierEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "tournamentId" TEXT NOT NULL DEFAULT 'main',
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "teamAId" TEXT,
    "teamBId" TEXT,
    "poolRevisionId" TEXT,
    "participants" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "published" BOOLEAN NOT NULL DEFAULT false,
    "bracket" TEXT NOT NULL DEFAULT '',
    "resultMode" "MatchResultMode" NOT NULL DEFAULT 'MAPS',
    "sourceKey" TEXT,
    "source" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "winnerSide" "MatchSide",
    "forfeitSide" "MatchSide",
    "rollA" INTEGER,
    "rollB" INTEGER,
    "firstPickSide" "MatchSide",
    "firstBanSide" "MatchSide",
    "firstProtectSide" "MatchSide",
    "lobbyUrl" TEXT NOT NULL DEFAULT '',
    "multiplayerId" INTEGER,
    "multiplayerSync" JSONB,
    "multiplayerSyncedAt" TIMESTAMP(3),
    "multiplayerError" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "timerKind" TEXT,
    "timerRemainingSeconds" INTEGER NOT NULL DEFAULT 0,
    "timerStartedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrcLobbyRequest" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "name" TEXT NOT NULL,
    "lobbyUrl" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IrcLobbyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchAssignment" (
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MatchAssignment_pkey" PRIMARY KEY ("matchId","userId")
);

-- CreateTable
CREATE TABLE "MultiplayerGame" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "multiplayerId" INTEGER NOT NULL,
    "gameId" TEXT NOT NULL,
    "beatmapId" INTEGER NOT NULL,
    "slotName" TEXT NOT NULL,
    "actionId" TEXT,
    "proposal" JSONB,
    "evidence" JSONB,
    "ignoredAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MultiplayerGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefereeImport" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "records" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefereeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchMapAction" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "MapActionKind" NOT NULL,
    "side" "MatchSide" NOT NULL,
    "slotName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "provenance" JSONB,

    CONSTRAINT "MatchMapAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchMapResult" (
    "entryMode" TEXT NOT NULL DEFAULT 'SCORES',
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "scoreA" DOUBLE PRECISION,
    "scoreB" DOUBLE PRECISION,
    "winnerSide" "MatchSide" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchMapResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayerScore" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "osuId" INTEGER NOT NULL,
    "side" "MatchSide" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "mods" JSONB NOT NULL,

    CONSTRAINT "MatchPlayerScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "side" "MatchSide",
    "notes" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchResultRevision" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdBy" TEXT,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResultRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL DEFAULT 'osu! Tournament Platform',
    "description" TEXT NOT NULL DEFAULT '',
    "logo" TEXT NOT NULL DEFAULT '',
    "favicon" TEXT NOT NULL DEFAULT '',
    "socialImage" TEXT NOT NULL DEFAULT '',
    "primaryDomain" TEXT NOT NULL DEFAULT '',
    "footer" TEXT NOT NULL DEFAULT '',
    "contact" TEXT NOT NULL DEFAULT '',
    "socialLinks" JSONB NOT NULL DEFAULT '[]',
    "primaryColor" TEXT NOT NULL DEFAULT '#e89caa',
    "accentColor" TEXT NOT NULL DEFAULT '#b6a0e5',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "rootMode" TEXT NOT NULL DEFAULT 'DIRECTORY',
    "defaultTournamentId" TEXT,
    "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bootstrapOwnerOsuId" INTEGER,
    "ownerBootstrappedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAsset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_osuId_key" ON "User"("osuId");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_systemKey_key" ON "Role"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tournamentId_name_key" ON "Role"("tournamentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_id_tournamentId_key" ON "Role"("id", "tournamentId");

-- CreateIndex
CREATE INDEX "UserRole_userId_tournamentId_idx" ON "UserRole"("userId", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_slug_key" ON "Tournament"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Page_draftRevisionId_key" ON "Page"("draftRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_publishedRevisionId_key" ON "Page"("publishedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_tournamentId_slug_key" ON "Page"("tournamentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Page_id_tournamentId_key" ON "Page"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_draftRevisionId_tournamentId_key" ON "Page"("draftRevisionId", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_publishedRevisionId_tournamentId_key" ON "Page"("publishedRevisionId", "tournamentId");

-- CreateIndex
CREATE INDEX "PageRevision_pageId_createdAt_idx" ON "PageRevision"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PageRevision_id_tournamentId_key" ON "PageRevision"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBlock_revisionId_position_key" ON "ContentBlock"("revisionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_tournamentId_slug_key" ON "TournamentStage"("tournamentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_id_tournamentId_key" ON "TournamentStage"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "ModCategory_tournamentId_acronym_key" ON "ModCategory"("tournamentId", "acronym");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_stageId_key" ON "Mappool"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_draftRevisionId_key" ON "Mappool"("draftRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_publishedRevisionId_key" ON "Mappool"("publishedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_id_tournamentId_key" ON "Mappool"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_stageId_tournamentId_key" ON "Mappool"("stageId", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_draftRevisionId_tournamentId_key" ON "Mappool"("draftRevisionId", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Mappool_publishedRevisionId_tournamentId_key" ON "Mappool"("publishedRevisionId", "tournamentId");

-- CreateIndex
CREATE INDEX "MappoolRevision_mappoolId_createdAt_idx" ON "MappoolRevision"("mappoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MappoolRevision_id_tournamentId_key" ON "MappoolRevision"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "MappoolSlot_revisionId_name_key" ON "MappoolSlot"("revisionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MappoolSlot_revisionId_position_key" ON "MappoolSlot"("revisionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_tournamentId_osuId_key" ON "StaffMember"("tournamentId", "osuId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_id_tournamentId_key" ON "StaffMember"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCategory_id_tournamentId_key" ON "StaffCategory"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_key_key" ON "MediaAsset"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_id_tournamentId_key" ON "MediaAsset"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_sourceKey_key" ON "Team"("sourceKey");

-- CreateIndex
CREATE INDEX "Team_published_status_position_idx" ON "Team"("published", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Team_tournamentId_slug_key" ON "Team"("tournamentId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_tournamentId_key" ON "Team"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_position_key" ON "TeamMember"("teamId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_tournamentId_osuId_key" ON "TeamMember"("tournamentId", "osuId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "QualifierLobby_scheduledAt_status_idx" ON "QualifierLobby"("scheduledAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualifierLobby_tournamentId_code_key" ON "QualifierLobby"("tournamentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "QualifierLobby_id_tournamentId_key" ON "QualifierLobby"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "QualifierEntry_lobbyId_position_key" ON "QualifierEntry"("lobbyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QualifierScore_lobbyId_osuId_slotName_key" ON "QualifierScore"("lobbyId", "osuId", "slotName");

-- CreateIndex
CREATE UNIQUE INDEX "QualifierEvent_lobbyId_version_key" ON "QualifierEvent"("lobbyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Match_sourceKey_key" ON "Match"("sourceKey");

-- CreateIndex
CREATE INDEX "Match_status_scheduledAt_idx" ON "Match"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_stageId_teamAId_teamBId_scheduledAt_key" ON "Match"("stageId", "teamAId", "teamBId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournamentId_code_key" ON "Match"("tournamentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Match_id_tournamentId_key" ON "Match"("id", "tournamentId");

-- CreateIndex
CREATE INDEX "IrcLobbyRequest_matchId_createdAt_idx" ON "IrcLobbyRequest"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchAssignment_userId_idx" ON "MatchAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MultiplayerGame_matchId_multiplayerId_gameId_key" ON "MultiplayerGame"("matchId", "multiplayerId", "gameId");

-- CreateIndex
CREATE INDEX "RefereeImport_tournamentId_createdAt_idx" ON "RefereeImport"("tournamentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchMapAction_matchId_sequence_key" ON "MatchMapAction"("matchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MatchMapResult_actionId_key" ON "MatchMapResult"("actionId");

-- CreateIndex
CREATE INDEX "MatchMapResult_matchId_idx" ON "MatchMapResult"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayerScore_resultId_osuId_key" ON "MatchPlayerScore"("resultId", "osuId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchEvent_matchId_version_key" ON "MatchEvent"("matchId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MatchResultRevision_matchId_version_key" ON "MatchResultRevision"("matchId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAsset_key_key" ON "PlatformAsset"("key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_tournamentId_fkey" FOREIGN KEY ("roleId", "tournamentId") REFERENCES "Role"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentSettings" ADD CONSTRAINT "TournamentSettings_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_draftRevisionId_tournamentId_fkey" FOREIGN KEY ("draftRevisionId", "tournamentId") REFERENCES "PageRevision"("id", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_publishedRevisionId_tournamentId_fkey" FOREIGN KEY ("publishedRevisionId", "tournamentId") REFERENCES "PageRevision"("id", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_pageId_tournamentId_fkey" FOREIGN KEY ("pageId", "tournamentId") REFERENCES "Page"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBlock" ADD CONSTRAINT "ContentBlock_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PageRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_nextStageId_tournamentId_fkey" FOREIGN KEY ("nextStageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_bannerImageId_tournamentId_fkey" FOREIGN KEY ("bannerImageId", "tournamentId") REFERENCES "MediaAsset"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModCategory" ADD CONSTRAINT "ModCategory_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mappool" ADD CONSTRAINT "Mappool_stageId_tournamentId_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mappool" ADD CONSTRAINT "Mappool_draftRevisionId_tournamentId_fkey" FOREIGN KEY ("draftRevisionId", "tournamentId") REFERENCES "MappoolRevision"("id", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mappool" ADD CONSTRAINT "Mappool_publishedRevisionId_tournamentId_fkey" FOREIGN KEY ("publishedRevisionId", "tournamentId") REFERENCES "MappoolRevision"("id", "tournamentId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappoolRevision" ADD CONSTRAINT "MappoolRevision_mappoolId_tournamentId_fkey" FOREIGN KEY ("mappoolId", "tournamentId") REFERENCES "Mappool"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappoolRevision" ADD CONSTRAINT "MappoolRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappoolSlot" ADD CONSTRAINT "MappoolSlot_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "MappoolRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappoolSlot" ADD CONSTRAINT "MappoolSlot_beatmapId_fkey" FOREIGN KEY ("beatmapId") REFERENCES "Beatmap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCategory" ADD CONSTRAINT "StaffCategory_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_memberId_tournamentId_fkey" FOREIGN KEY ("memberId", "tournamentId") REFERENCES "StaffMember"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_categoryId_tournamentId_fkey" FOREIGN KEY ("categoryId", "tournamentId") REFERENCES "StaffCategory"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_logoImageId_tournamentId_fkey" FOREIGN KEY ("logoImageId", "tournamentId") REFERENCES "MediaAsset"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_tournamentId_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_osuId_fkey" FOREIGN KEY ("osuId") REFERENCES "Participant"("osuId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierLobby" ADD CONSTRAINT "QualifierLobby_stageId_tournamentId_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierLobby" ADD CONSTRAINT "QualifierLobby_poolRevisionId_tournamentId_fkey" FOREIGN KEY ("poolRevisionId", "tournamentId") REFERENCES "MappoolRevision"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierEntry" ADD CONSTRAINT "QualifierEntry_lobbyId_tournamentId_fkey" FOREIGN KEY ("lobbyId", "tournamentId") REFERENCES "QualifierLobby"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierEntry" ADD CONSTRAINT "QualifierEntry_teamId_tournamentId_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierAssignment" ADD CONSTRAINT "QualifierAssignment_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "QualifierLobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierAssignment" ADD CONSTRAINT "QualifierAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "QualifierLobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_osuId_fkey" FOREIGN KEY ("osuId") REFERENCES "Participant"("osuId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierEvent" ADD CONSTRAINT "QualifierEvent_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "QualifierLobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifierEvent" ADD CONSTRAINT "QualifierEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_stageId_tournamentId_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamAId_tournamentId_fkey" FOREIGN KEY ("teamAId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamBId_tournamentId_fkey" FOREIGN KEY ("teamBId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_poolRevisionId_tournamentId_fkey" FOREIGN KEY ("poolRevisionId", "tournamentId") REFERENCES "MappoolRevision"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrcLobbyRequest" ADD CONSTRAINT "IrcLobbyRequest_match_fkey" FOREIGN KEY ("matchId", "tournamentId") REFERENCES "Match"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrcLobbyRequest" ADD CONSTRAINT "IrcLobbyRequest_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAssignment" ADD CONSTRAINT "MatchAssignment_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchAssignment" ADD CONSTRAINT "MatchAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultiplayerGame" ADD CONSTRAINT "MultiplayerGame_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefereeImport" ADD CONSTRAINT "RefereeImport_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefereeImport" ADD CONSTRAINT "RefereeImport_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMapAction" ADD CONSTRAINT "MatchMapAction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMapAction" ADD CONSTRAINT "MatchMapAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMapResult" ADD CONSTRAINT "MatchMapResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchMapResult" ADD CONSTRAINT "MatchMapResult_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "MatchMapAction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayerScore" ADD CONSTRAINT "MatchPlayerScore_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "MatchMapResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayerScore" ADD CONSTRAINT "MatchPlayerScore_osuId_fkey" FOREIGN KEY ("osuId") REFERENCES "Participant"("osuId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResultRevision" ADD CONSTRAINT "MatchResultRevision_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchResultRevision" ADD CONSTRAINT "MatchResultRevision_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSettings" ADD CONSTRAINT "PlatformSettings_defaultTournamentId_fkey" FOREIGN KEY ("defaultTournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Match" ADD CONSTRAINT "Match_distinct_teams" CHECK ("teamAId" <> "teamBId");
ALTER TABLE "Match" ADD CONSTRAINT "Match_nonnegative_points" CHECK ("scoreA" >= 0 AND "scoreB" >= 0 AND "version" > 0);
ALTER TABLE "MatchMapResult" ADD CONSTRAINT "MatchMapResult_valid_scores" CHECK (("entryMode" = 'WINNER_ONLY' AND "scoreA" IS NULL AND "scoreB" IS NULL) OR ("entryMode" = 'SCORES' AND "scoreA" IS NOT NULL AND "scoreB" IS NOT NULL AND "scoreA" BETWEEN 0 AND 9007199254740991 AND "scoreB" BETWEEN 0 AND 9007199254740991));
ALTER TABLE "MatchPlayerScore" ADD CONSTRAINT "MatchPlayerScore_valid_score" CHECK ("score" BETWEEN 0 AND 9007199254740991 AND ("accuracy" IS NULL OR "accuracy" BETWEEN 0 AND 100));
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_captain_not_substitute" CHECK (NOT ("captain" AND "substitute"));
ALTER TABLE "QualifierLobby" ADD CONSTRAINT "QualifierLobby_positive_version" CHECK ("version" > 0);
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_valid_scores" CHECK ("raw" BETWEEN 0 AND 9007199254740991 AND "adjusted" BETWEEN 0 AND 9007199254740991);
ALTER TABLE "IrcLobbyRequest" ADD CONSTRAINT "IrcLobbyRequest_status_check" CHECK ("status" IN ('PENDING','UNKNOWN','CREATED','FAILED','RESOLVED'));
CREATE UNIQUE INDEX "IrcLobbyRequest_active_match_key" ON "IrcLobbyRequest"("matchId") WHERE "status" IN ('PENDING','UNKNOWN');
CREATE UNIQUE INDEX "IrcLobbyRequest_active_user_key" ON "IrcLobbyRequest"("userId") WHERE "status" IN ('PENDING','UNKNOWN');

