ALTER TABLE "QualifierScore" ADD COLUMN "passed" BOOLEAN;
ALTER TABLE "QualifierScore" ADD COLUMN "eligibilityOverride" TEXT;
ALTER TABLE "QualifierScore" ADD CONSTRAINT "QualifierScore_eligibilityOverride_check"
CHECK ("eligibilityOverride" IS NULL OR "eligibilityOverride" IN ('INCLUDE', 'EXCLUDE'));
