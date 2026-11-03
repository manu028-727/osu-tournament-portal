-- Per-player evidence for qualifiers seeded on accuracy or combo. Existing rows keep
-- null, and saved source hashes name their fields so these columns cannot alter them.
ALTER TABLE "QualifierScore" ADD COLUMN "accuracy" DOUBLE PRECISION;
ALTER TABLE "QualifierScore" ADD COLUMN "maxCombo" INTEGER;
ALTER TABLE "QualifierScore" ADD COLUMN "misses" INTEGER;
