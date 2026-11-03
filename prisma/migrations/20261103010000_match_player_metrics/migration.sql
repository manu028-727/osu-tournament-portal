-- Per-player evidence for maps decided on combo or misses. Existing rows keep null,
-- which reads as "not recorded", never as zero.
ALTER TABLE "MatchPlayerScore" ADD COLUMN "maxCombo" INTEGER;
ALTER TABLE "MatchPlayerScore" ADD COLUMN "misses" INTEGER;
