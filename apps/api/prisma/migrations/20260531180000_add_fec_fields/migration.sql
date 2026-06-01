-- Add periodType and errorMessage to fec_imports
ALTER TABLE "fec_imports" ADD COLUMN "periodType" TEXT NOT NULL DEFAULT 'mensuelle';
ALTER TABLE "fec_imports" ADD COLUMN "errorMessage" TEXT;

-- Add missing FEC columns to fec_entries
ALTER TABLE "fec_entries" ADD COLUMN "journalLib" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fec_entries" ADD COLUMN "ecritureLib" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fec_entries" ADD COLUMN "compAuxNum" TEXT;
ALTER TABLE "fec_entries" ADD COLUMN "compAuxLib" TEXT;
ALTER TABLE "fec_entries" ADD COLUMN "dateLet" DATE;
ALTER TABLE "fec_entries" ADD COLUMN "validDate" DATE;
