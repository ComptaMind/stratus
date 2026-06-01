-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "countryDefault" TEXT NOT NULL DEFAULT 'FR',
ADD COLUMN     "siren" TEXT,
ADD COLUMN     "siret" TEXT,
ADD COLUMN     "vatRegimeDefault" TEXT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(6),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "fiscal_clients" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siren" TEXT,
    "vatNumber" TEXT,
    "vatRegime" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'FR',
    "fiscalYearStart" TEXT NOT NULL DEFAULT '01-01',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fiscal_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fec_imports" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fiscalClientId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "entriesCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fec_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fec_entries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fecImportId" TEXT NOT NULL,
    "journalCode" TEXT NOT NULL,
    "ecritureNum" TEXT NOT NULL,
    "ecritureDate" DATE NOT NULL,
    "compteNum" TEXT NOT NULL,
    "compteLib" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL,
    "credit" DECIMAL(14,2) NOT NULL,
    "pieceRef" TEXT,
    "pieceDate" DATE,
    "lettrage" TEXT,
    "montantDevise" DECIMAL(14,2),
    "codeDevise" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fec_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_classifications" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fecEntryId" TEXT NOT NULL,
    "vatType" TEXT NOT NULL,
    "baseHt" DECIMAL(14,2) NOT NULL,
    "tvaAmount" DECIMAL(14,2) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "humanReviewed" BOOLEAN NOT NULL DEFAULT false,
    "humanOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vat_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ca3_declarations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fiscalClientId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "periodType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "tvaCollecteeTotal" DECIMAL(14,2) NOT NULL,
    "tvaDeductibleTotal" DECIMAL(14,2) NOT NULL,
    "tvaDue" DECIMAL(14,2) NOT NULL,
    "creditTva" DECIMAL(14,2) NOT NULL,
    "regime" TEXT NOT NULL,
    "fieldsJson" JSONB NOT NULL,
    "xmlEdiUrl" TEXT,
    "filedAt" TIMESTAMPTZ(6),
    "dgfipReference" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ca3_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_clients_orgId_idx" ON "fiscal_clients"("orgId");

-- CreateIndex
CREATE INDEX "fec_imports_orgId_idx" ON "fec_imports"("orgId");

-- CreateIndex
CREATE INDEX "fec_entries_fecImportId_compteNum_idx" ON "fec_entries"("fecImportId", "compteNum");

-- CreateIndex
CREATE INDEX "fec_entries_orgId_idx" ON "fec_entries"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "vat_classifications_fecEntryId_key" ON "vat_classifications"("fecEntryId");

-- CreateIndex
CREATE INDEX "vat_classifications_orgId_idx" ON "vat_classifications"("orgId");

-- CreateIndex
CREATE INDEX "ca3_declarations_orgId_idx" ON "ca3_declarations"("orgId");

-- CreateIndex
CREATE INDEX "audit_events_orgId_idx" ON "audit_events"("orgId");

-- AddForeignKey
ALTER TABLE "fiscal_clients" ADD CONSTRAINT "fiscal_clients_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fec_imports" ADD CONSTRAINT "fec_imports_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fec_imports" ADD CONSTRAINT "fec_imports_fiscalClientId_fkey" FOREIGN KEY ("fiscalClientId") REFERENCES "fiscal_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fec_imports" ADD CONSTRAINT "fec_imports_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fec_entries" ADD CONSTRAINT "fec_entries_fecImportId_fkey" FOREIGN KEY ("fecImportId") REFERENCES "fec_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_classifications" ADD CONSTRAINT "vat_classifications_fecEntryId_fkey" FOREIGN KEY ("fecEntryId") REFERENCES "fec_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ca3_declarations" ADD CONSTRAINT "ca3_declarations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ca3_declarations" ADD CONSTRAINT "ca3_declarations_fiscalClientId_fkey" FOREIGN KEY ("fiscalClientId") REFERENCES "fiscal_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AuditEvent immutability: block UPDATE and DELETE at the database level
CREATE OR REPLACE FUNCTION prevent_audit_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only — UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_modification();
