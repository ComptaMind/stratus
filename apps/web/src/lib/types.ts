// ── Shared domain types for the Stratus web app ───────────────────────────────

export type DeclarationStatus =
  | "draft"
  | "pending_validation"
  | "validated"
  | "submitted"
  | "error";

export type PeriodType = "monthly" | "quarterly";

export type ImportStatus =
  | "uploaded"
  | "classifying"
  | "classified"
  | "error";

export interface FiscalClient {
  id: string;
  org_id: string;
  name: string;
  siret?: string;
  period_type: PeriodType;
  created_at: string;
  updated_at: string;
  // Derived / joined fields the API may return
  last_declaration?: DeclarationSummary | null;
  next_deadline?: string | null;
  tva_position?: "debit" | "credit" | "zero" | null;
  status?: "up_to_date" | "late" | "no_data";
}

export interface DeclarationSummary {
  id: string;
  period_start: string;
  period_end: string;
  status: DeclarationStatus;
  total_tva_due?: number | null;
  total_tva_deductible?: number | null;
  net_tva?: number | null;
}

export interface FECImport {
  id: string;
  fiscal_client_id: string;
  filename: string;
  status: ImportStatus;
  rows_count?: number | null;
  classified_at?: string | null;
  created_at: string;
  updated_at: string;
  error_message?: string | null;
}

export interface CA3Declaration {
  id: string;
  fiscal_client_id: string;
  fec_import_id?: string | null;
  org_id: string;
  period_start: string;
  period_end: string;
  period_type: PeriodType;
  status: DeclarationStatus;
  // CA3 form fields (all optional — may be null until computed)
  ca_ht_20?: number | null;
  ca_ht_10?: number | null;
  ca_ht_55?: number | null;
  ca_ht_0?: number | null;
  tva_20?: number | null;
  tva_10?: number | null;
  tva_55?: number | null;
  tva_collectee?: number | null;
  tva_deductible_immo?: number | null;
  tva_deductible_biens?: number | null;
  tva_deductible_services?: number | null;
  tva_deductible_total?: number | null;
  tva_nette?: number | null;
  credit_tva_precedent?: number | null;
  net_a_payer?: number | null;
  credit_a_reporter?: number | null;
  // Metadata
  validated_at?: string | null;
  submitted_at?: string | null;
  xml_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentSession {
  session_id: string;
  phase: string;
  node_call_count: number;
  ca3_ready: boolean;
  xml_ready: boolean;
}

export interface BofipSource {
  title: string;
  url: string;
  score: number;
}

export interface Ca3Warning {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp: Date;
  /** Structured CA3 lines rendered as a table card (type:"ca3" SSE event) */
  ca3Lines?: Record<string, string>;
  /** CA3 validation warnings/errors */
  ca3Warnings?: Ca3Warning[];
  /** BOFiP citation cards (type:"sources" SSE event) */
  sources?: BofipSource[];
}
