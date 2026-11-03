-- Budgets and purchasable items. A team's balance is never stored: it is derived from
-- these rows, auction prices and confirmed results, so corrections reverse by themselves.
ALTER TABLE "TournamentSettings" ADD COLUMN "resourcePolicy" JSONB;

CREATE TABLE "ResourceItem" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "unlockStageId" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResourceItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResourceItem_price_check" CHECK ("price" >= 0)
);
CREATE UNIQUE INDEX "ResourceItem_id_tournamentId_key" ON "ResourceItem"("id", "tournamentId");
CREATE INDEX "ResourceItem_tournamentId_position_idx" ON "ResourceItem"("tournamentId", "position");
ALTER TABLE "ResourceItem" ADD CONSTRAINT "ResourceItem_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResourceItem" ADD CONSTRAINT "ResourceItem_unlockStageId_tournamentId_fkey" FOREIGN KEY ("unlockStageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ResourcePurchase" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "stageId" TEXT,
    "price" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversedReason" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ResourcePurchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResourcePurchase_price_check" CHECK ("price" >= 0)
);
CREATE INDEX "ResourcePurchase_tournamentId_teamId_idx" ON "ResourcePurchase"("tournamentId", "teamId");
ALTER TABLE "ResourcePurchase" ADD CONSTRAINT "ResourcePurchase_itemId_tournamentId_fkey" FOREIGN KEY ("itemId", "tournamentId") REFERENCES "ResourceItem"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourcePurchase" ADD CONSTRAINT "ResourcePurchase_teamId_tournamentId_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourcePurchase" ADD CONSTRAINT "ResourcePurchase_stageId_tournamentId_fkey" FOREIGN KEY ("stageId", "tournamentId") REFERENCES "TournamentStage"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourcePurchase" ADD CONSTRAINT "ResourcePurchase_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResourcePurchase" ADD CONSTRAINT "ResourcePurchase_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ResourceAdjustment" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResourceAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResourceAdjustment_amount_check" CHECK ("amount" <> 0)
);
CREATE INDEX "ResourceAdjustment_tournamentId_teamId_idx" ON "ResourceAdjustment"("tournamentId", "teamId");
ALTER TABLE "ResourceAdjustment" ADD CONSTRAINT "ResourceAdjustment_teamId_tournamentId_fkey" FOREIGN KEY ("teamId", "tournamentId") REFERENCES "Team"("id", "tournamentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceAdjustment" ADD CONSTRAINT "ResourceAdjustment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
