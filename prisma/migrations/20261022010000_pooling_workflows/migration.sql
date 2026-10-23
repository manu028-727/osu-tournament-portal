-- CreateTable
CREATE TABLE "PoolPlan" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "slots" JSONB NOT NULL DEFAULT '[]',
    "minStars" DOUBLE PRECISION,
    "maxStars" DOUBLE PRECISION,
    "reviewState" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolCandidate" (
    "warningResolution" JSONB,
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stageId" TEXT,
    "beatmapId" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "notes" TEXT NOT NULL DEFAULT '',
    "submitterId" TEXT,
    "selectedSlot" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolSkillset" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PoolSkillset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolCandidateTag" (
    "tournamentId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "skillsetId" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PoolCandidateTag_pkey" PRIMARY KEY ("candidateId","skillsetId")
);

-- CreateTable
CREATE TABLE "PoolReview" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "fit" INTEGER,
    "difficulty" INTEGER,
    "flags" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolArtistWarning" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "artistKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARN',
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PoolArtistWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoolPlan_stageId_key" ON "PoolPlan"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolPlan_id_tournamentId_key" ON "PoolPlan"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolPlan_stageId_tournamentId_key" ON "PoolPlan"("stageId", "tournamentId");

-- CreateIndex
CREATE INDEX "PoolCandidate_tournamentId_stageId_status_idx" ON "PoolCandidate"("tournamentId", "stageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PoolCandidate_id_tournamentId_key" ON "PoolCandidate"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolCandidate_tournamentId_beatmapId_key" ON "PoolCandidate"("tournamentId", "beatmapId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolSkillset_id_tournamentId_key" ON "PoolSkillset"("id", "tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolSkillset_tournamentId_name_key" ON "PoolSkillset"("tournamentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "PoolReview_candidateId_reviewerId_key" ON "PoolReview"("candidateId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolArtistWarning_tournamentId_artistKey_key" ON "PoolArtistWarning"("tournamentId", "artistKey");

-- AddForeignKey
ALTER TABLE "PoolPlan" ADD CONSTRAINT "PoolPlan_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolPlan" ADD CONSTRAINT "PoolPlan_stageId_tournamentId_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCandidate" ADD CONSTRAINT "PoolCandidate_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCandidate" ADD CONSTRAINT "PoolCandidate_stageId_tournamentId_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCandidate" ADD CONSTRAINT "PoolCandidate_beatmapId_fkey" FOREIGN KEY ("beatmapId") REFERENCES "Beatmap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCandidate" ADD CONSTRAINT "PoolCandidate_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSkillset" ADD CONSTRAINT "PoolSkillset_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCandidateTag" ADD CONSTRAINT "PoolCandidateTag_candidateId_tournamentId_fkey" FOREIGN KEY ("candidateId", "tournamentId") REFERENCES "PoolCandidate"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolCandidateTag" ADD CONSTRAINT "PoolCandidateTag_skillsetId_tournamentId_fkey" FOREIGN KEY ("skillsetId", "tournamentId") REFERENCES "PoolSkillset"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolReview" ADD CONSTRAINT "PoolReview_candidateId_tournamentId_fkey" FOREIGN KEY ("candidateId", "tournamentId") REFERENCES "PoolCandidate"("id", "tournamentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolReview" ADD CONSTRAINT "PoolReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolArtistWarning" ADD CONSTRAINT "PoolArtistWarning_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
