/**
 * Replay layer types — shared between AuditService and AuditController.
 *
 * A ReplayBundle is the complete, forensically-sound reconstruction of
 * every decision made by the AI agent for a given entity (CA3Declaration,
 * FECImport, etc.).  It enables DGFiP controllers to inspect:
 *   - Every prompt sent to an LLM, the exact model + version + temperature
 *   - Every BOFiP chunk retrieved by RAG (with scores and version dates)
 *   - The chronological sequence of agent transitions
 *
 * This is the key auditability differentiator vs Pennylane / Black Ore.
 * PRD reference: §5.1 "Replay & Auditability".
 */

// ── Snapshot of a single AuditEvent (serialisation-safe) ─────────────────────

export interface AuditEventSnapshot {
  id: string;
  createdAt: Date;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

// ── RAG chunk as stored in AuditEvent.payload ─────────────────────────────────

export interface RAGChunk {
  url: string;
  title: string;
  text: string;
  score: number;
  bofipId?: string;
  chunkIndex?: number;
  sectionPath?: string;
}

// ── One LLM call extracted from AuditEvents ───────────────────────────────────

export interface LLMCallArtifact {
  eventId: string;
  timestamp: Date;
  action: string;
  /** Full system + user prompt as sent to the model */
  prompt: string;
  /** Short model family, e.g. "claude-sonnet-4-6" */
  model: string;
  /** Full model version string as returned by Anthropic API */
  modelVersion: string;
  temperature?: number;
  response: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  latencyMs?: number;
  /** BOFiP chunks that were injected as context for this call */
  ragSources: RAGChunk[];
}

// ── One RAG retrieval extracted from AuditEvents ──────────────────────────────

export interface RAGRetrievalArtifact {
  eventId: string;
  timestamp: Date;
  query: string;
  chunks: RAGChunk[];
  latencyMs?: number;
  /** ISO date of the BOFiP corpus version used at retrieval time */
  bofipVersionDate?: string;
}

// ── Fiscal code state: BOFiP corpus snapshot at time of declaration ───────────

export interface FiscalCodeState {
  /** ISO date of the BOFiP corpus version (derived from event payloads) */
  bofipVersionDate: string;
  /** BOFiP section IDs that were referenced during the session */
  relevantSections: string[];
  /** When this state snapshot was reconstructed */
  snapshotAt: Date;
}

// ── Top-level bundle ──────────────────────────────────────────────────────────

export interface ReplayBundle {
  entityType: string;
  entityId: string;
  orgId: string;
  /** All audit events, chronological */
  events: AuditEventSnapshot[];
  /** Extracted LLM calls with full prompt + response */
  llmCalls: LLMCallArtifact[];
  /** Extracted RAG retrievals with chunks + scores */
  ragRetrievals: RAGRetrievalArtifact[];
  /** BOFiP state at time of declaration */
  fiscalCodeState: FiscalCodeState;
  /** When this bundle was generated (for cache invalidation) */
  generatedAt: Date;
}

// ── Re-run comparison result ──────────────────────────────────────────────────

export interface LLMRerunResult {
  originalEventId: string;
  originalModel: string;
  originalResponse: string;
  currentModel: string;
  currentResponse: string;
  prompt: string;
  ragSources: RAGChunk[];
  comparedAt: Date;
}
