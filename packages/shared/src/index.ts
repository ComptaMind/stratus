// Stratus — shared TypeScript types
// Mirrors the Prisma schema. Keep in sync with apps/api/prisma/schema.prisma.

// ── Generic envelope ──────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  data: T;
  status: "success" | "error";
  message?: string;
  timestamp: string;
}

export interface HealthResponse {
  status: "ok";
}

// ── Enums / union types ───────────────────────────────────────────────────────

export type VatRegime = "réel normal" | "réel simplifié" | "franchise";

export type FECImportStatus = "pending" | "parsed" | "classified" | "failed";

export type VatType =
  | "collectée 20"
  | "collectée 10"
  | "collectée 5.5"
  | "collectée 2.1"
  | "déductible biens 20"
  | "déductible biens 10"
  | "déductible services 20"
  | "déductible services 10"
  | "intracom acquisition"
  | "intracom livraison"
  | "autoliquidation BTP"
  | "non soumise"
  | "export"
  | "import";

export type CA3PeriodType = "mensuelle" | "trimestrielle";

export type CA3Status =
  | "draft"
  | "computed"
  | "validated"
  | "filed"
  | "rejected";

export type AuditActorType = "user" | "agent" | "system";

export type AuditAction =
  | "fec.upload"
  | "fec.parsed"
  | "entry.classified"
  | "entry.reviewed"
  | "declaration.computed"
  | "declaration.validated"
  | "declaration.filed"
  | "declaration.rejected"
  | string; // extensible

// ── Entity DTOs ───────────────────────────────────────────────────────────────

export interface OrganizationDto {
  id: string;
  clerkOrgId: string;
  name: string;
  countryDefault: string;
  vatRegimeDefault: VatRegime | null;
  siret: string | null;
  siren: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDto {
  id: string;
  clerkUserId: string;
  email: string;
  orgId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FiscalClientDto {
  id: string;
  orgId: string;
  name: string;
  siren: string | null;
  vatNumber: string | null;
  vatRegime: VatRegime;
  country: string;
  fiscalYearStart: string; // MM-DD
  createdAt: Date;
  updatedAt: Date;
}

export interface FECImportDto {
  id: string;
  orgId: string;
  fiscalClientId: string;
  filename: string;
  fileUrl: string;
  periodStart: Date;
  periodEnd: Date;
  status: FECImportStatus;
  entriesCount: number;
  uploadedByUserId: string;
  createdAt: Date;
}

export interface FECEntryDto {
  id: string;
  orgId: string;
  fecImportId: string;
  journalCode: string;
  ecritureNum: string;
  ecritureDate: Date;
  compteNum: string;
  compteLib: string;
  debit: string;   // Decimal serialized as string
  credit: string;  // Decimal serialized as string
  pieceRef: string | null;
  pieceDate: Date | null;
  lettrage: string | null;
  montantDevise: string | null;
  codeDevise: string | null;
  createdAt: Date;
}

export interface VATClassificationDto {
  id: string;
  orgId: string;
  fecEntryId: string;
  vatType: VatType;
  baseHt: string;     // Decimal serialized as string
  tvaAmount: string;  // Decimal serialized as string
  confidence: number;
  modelUsed: string;
  reasoning: string;
  humanReviewed: boolean;
  humanOverridden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CA3DeclarationDto {
  id: string;
  orgId: string;
  fiscalClientId: string;
  periodStart: Date;
  periodEnd: Date;
  periodType: CA3PeriodType;
  status: CA3Status;
  tvaCollecteeTotal: string;
  tvaDeductibleTotal: string;
  tvaDue: string;
  creditTva: string;
  regime: string;
  fieldsJson: Record<string, unknown>;
  xmlEdiUrl: string | null;
  filedAt: Date | null;
  dgfipReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEventDto {
  id: string;
  orgId: string;
  actorType: AuditActorType;
  actorId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

// ── FEC raw line (parsing) ────────────────────────────────────────────────────

export interface FecRawLine {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: string;   // YYYYMMDD
  compteNum: string;
  compteLib: string;
  compAuxNum?: string;
  compAuxLib?: string;
  pieceRef: string;
  pieceDate: string;
  ecritureLib: string;
  debit: string;
  credit: string;
  ecritureLet?: string;
  dateLet?: string;
  validDate?: string;
  montantDevise?: string;
  idevise?: string;
}
