import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildZip, ZipFile } from "./zip.util";
import type {
  AuditEventSnapshot,
  FiscalCodeState,
  LLMCallArtifact,
  LLMRerunResult,
  RAGChunk,
  RAGRetrievalArtifact,
  ReplayBundle,
} from "./replay.types";

export interface AuditLogParams {
  orgId: string;
  actorType: "user" | "agent" | "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}

/** Current model used for LLM re-run comparisons */
const CURRENT_MODEL = "claude-sonnet-4-6";

/**
 * Append-only audit log writer + replay layer.
 *
 * log()               — append an AuditEvent (every mutating action calls this)
 * replay()            — reconstruct the full decision trace for an entity
 * exportReplayBundle()— zip of audit_log.jsonl + prompts/ + sources/ + XML
 * rerunWithCurrentModel() — re-run an archived LLM prompt with the current
 *                       Claude model for QA comparison
 *
 * The DB trigger prevents UPDATE/DELETE on audit_events (immutability guard).
 * PRD reference: §5.1 "Replay & Auditability".
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Append ────────────────────────────────────────────────────────────────

  async log(params: AuditLogParams): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          orgId: params.orgId,
          actorType: params.actorType,
          actorId: params.actorId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          payload: params.payload as any,
        },
      });
    } catch (err) {
      // Audit failure must never crash the main request — log and continue.
      this.logger.error(`Audit log failed for action=${params.action}`, err);
    }
  }

  // ── Replay ────────────────────────────────────────────────────────────────

  /**
   * Reconstruct the full decision trace for a given entity.
   *
   * Returns all AuditEvents in chronological order, then extracts:
   *  - LLM calls (events whose payload contains a `prompt` field)
   *  - RAG retrievals (events whose payload contains `retrieved_chunks`)
   *  - Fiscal code state (earliest BOFiP version date across all events)
   *
   * @param entityType  e.g. "CA3Declaration" | "FECImport"
   * @param entityId    the Prisma entity UUID
   * @param orgId       tenant scope — must match the authenticated org
   */
  async replay(
    entityType: string,
    entityId: string,
    orgId: string,
  ): Promise<ReplayBundle> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { entityId, entityType, orgId },
      orderBy: { createdAt: "asc" },
    });

    if (rows.length === 0) {
      throw new NotFoundException(
        `No audit events found for ${entityType}/${entityId}`,
      );
    }

    const events: AuditEventSnapshot[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      actorType: r.actorType,
      actorId: r.actorId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      payload: r.payload as Record<string, unknown>,
    }));

    const llmCalls = this._extractLLMCalls(events);
    const ragRetrievals = this._extractRAGRetrievals(events);
    const fiscalCodeState = this._reconstructFiscalCodeState(events, ragRetrievals);

    return {
      entityType,
      entityId,
      orgId,
      events,
      llmCalls,
      ragRetrievals,
      fiscalCodeState,
      generatedAt: new Date(),
    };
  }

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * Build and return a ZIP archive suitable for DGFiP controller review.
   *
   * Contents:
   *   audit_log.jsonl          — one JSON line per AuditEvent, chronological
   *   prompts/event-{id}.txt   — full prompt + response for each LLM call
   *   sources/chunk-{n}.html   — each RAG chunk (BOFiP text + metadata)
   *   declaration_xml.xml      — EDI-TVA XML if present in the events
   *   README.txt               — human-readable explanation of the bundle
   */
  async exportReplayBundle(
    entityType: string,
    entityId: string,
    orgId: string,
  ): Promise<Buffer> {
    const bundle = await this.replay(entityType, entityId, orgId);
    const files: ZipFile[] = [];

    // ── audit_log.jsonl ───────────────────────────────────────────────────
    const jsonl = bundle.events
      .map((e) => JSON.stringify(e))
      .join("\n");
    files.push({ name: "audit_log.jsonl", data: Buffer.from(jsonl, "utf8") });

    // ── prompts/ ──────────────────────────────────────────────────────────
    for (const call of bundle.llmCalls) {
      const content = [
        `# LLM Call — Event ${call.eventId}`,
        `Timestamp : ${call.timestamp.toISOString()}`,
        `Action    : ${call.action}`,
        `Model     : ${call.model} (${call.modelVersion})`,
        `Temperature: ${call.temperature ?? "default"}`,
        `Latency   : ${call.latencyMs ?? "n/a"} ms`,
        `Tokens    : prompt=${call.tokensPrompt ?? "n/a"} completion=${call.tokensCompletion ?? "n/a"}`,
        "",
        "## Prompt",
        call.prompt,
        "",
        "## Response",
        call.response,
        "",
        "## RAG Sources",
        call.ragSources.map((c, i) =>
          `[${i + 1}] ${c.title} (score=${c.score.toFixed(3)}) ${c.url}`,
        ).join("\n"),
      ].join("\n");
      files.push({
        name: `prompts/event-${call.eventId}.txt`,
        data: Buffer.from(content, "utf8"),
      });
    }

    // ── sources/ ──────────────────────────────────────────────────────────
    let chunkIdx = 0;
    for (const retrieval of bundle.ragRetrievals) {
      for (const chunk of retrieval.chunks) {
        const html = this._chunkToHtml(chunk, retrieval, chunkIdx);
        files.push({
          name: `sources/chunk-${String(chunkIdx).padStart(3, "0")}.html`,
          data: Buffer.from(html, "utf8"),
        });
        chunkIdx++;
      }
    }

    // ── declaration_xml.xml ───────────────────────────────────────────────
    const xmlEvent = bundle.events.find(
      (e) =>
        e.action === "edi_tva.generated" ||
        e.action === "declaration.xml_generated",
    );
    if (xmlEvent?.payload?.xml_url) {
      // Note: in production, fetch from StorageService — here we embed the URL
      const xmlNote = `<!-- XML available at: ${xmlEvent.payload.xml_url} -->\n<!-- SHA-256: ${xmlEvent.payload.sha256 ?? "n/a"} -->`;
      files.push({
        name: "declaration_xml.xml",
        data: Buffer.from(xmlNote, "utf8"),
      });
    }

    // ── README.txt ────────────────────────────────────────────────────────
    files.push({
      name: "README.txt",
      data: Buffer.from(
        this._buildReadme(bundle),
        "utf8",
      ),
    });

    return buildZip(files);
  }

  // ── Re-run with current model ─────────────────────────────────────────────

  /**
   * Re-run an archived LLM prompt with the current Claude model.
   *
   * Useful for QA: compare the original agent response to what Claude
   * would say today with the same BOFiP context injected.
   *
   * Requires ANTHROPIC_API_KEY env var.  Falls back to a stub response
   * when the key is absent (e.g. in tests or CI without credentials).
   */
  async rerunWithCurrentModel(
    entityType: string,
    entityId: string,
    orgId: string,
    eventId: string,
  ): Promise<LLMRerunResult> {
    const bundle = await this.replay(entityType, entityId, orgId);

    const call = bundle.llmCalls.find((c) => c.eventId === eventId);
    if (!call) {
      throw new NotFoundException(
        `LLM call not found for eventId=${eventId} in entity ${entityId}`,
      );
    }

    const currentResponse = await this._callCurrentModel(call.prompt);

    return {
      originalEventId: call.eventId,
      originalModel: `${call.model} (${call.modelVersion})`,
      originalResponse: call.response,
      currentModel: CURRENT_MODEL,
      currentResponse,
      prompt: call.prompt,
      ragSources: call.ragSources,
      comparedAt: new Date(),
    };
  }

  // ── Private extraction helpers ────────────────────────────────────────────

  private _extractLLMCalls(events: AuditEventSnapshot[]): LLMCallArtifact[] {
    return events
      .filter((e) => {
        const p = e.payload;
        return (
          typeof p.prompt === "string" ||
          typeof p.system === "string" ||
          e.action.startsWith("llm.") ||
          e.action === "handle_question" ||
          e.action === "ask_user_clarification"
        );
      })
      .map((e) => {
        const p = e.payload;
        const sources = this._extractChunks(p.sources ?? p.rag_chunks ?? p.retrieved_chunks);
        return {
          eventId: e.id,
          timestamp: e.createdAt,
          action: e.action,
          prompt: String(p.prompt ?? p.system ?? ""),
          model: String(p.model ?? p.model_hint ?? "unknown"),
          modelVersion: String(p.model_version ?? p.modelVersion ?? "unknown"),
          temperature: typeof p.temperature === "number" ? p.temperature : undefined,
          response: String(p.response ?? p.content ?? p.answer ?? ""),
          tokensPrompt: typeof p.tokens_prompt === "number" ? p.tokens_prompt : undefined,
          tokensCompletion: typeof p.tokens_completion === "number" ? p.tokens_completion : undefined,
          latencyMs: typeof p.latency_ms === "number" ? p.latency_ms : undefined,
          ragSources: sources,
        } satisfies LLMCallArtifact;
      });
  }

  private _extractRAGRetrievals(events: AuditEventSnapshot[]): RAGRetrievalArtifact[] {
    return events
      .filter((e) => {
        const p = e.payload;
        return (
          Array.isArray(p.retrieved_chunks) ||
          Array.isArray(p.chunks) ||
          e.action === "rag.retrieval" ||
          e.action === "bofip.retrieval"
        );
      })
      .map((e) => {
        const p = e.payload;
        const chunks = this._extractChunks(
          p.retrieved_chunks ?? p.chunks ?? [],
        );
        return {
          eventId: e.id,
          timestamp: e.createdAt,
          query: String(p.query ?? ""),
          chunks,
          latencyMs: typeof p.retrieval_latency_ms === "number"
            ? p.retrieval_latency_ms
            : undefined,
          bofipVersionDate: typeof p.bofip_version_date === "string"
            ? p.bofip_version_date
            : undefined,
        } satisfies RAGRetrievalArtifact;
      });
  }

  private _extractChunks(raw: unknown): RAGChunk[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => ({
        url: String(c.url ?? ""),
        title: String(c.title ?? ""),
        text: String(c.text ?? ""),
        score: typeof c.score === "number" ? c.score : 0,
        bofipId: typeof c.bofip_id === "string" ? c.bofip_id : undefined,
        chunkIndex: typeof c.chunk_index === "number" ? c.chunk_index : undefined,
        sectionPath: typeof c.section_path === "string" ? c.section_path : undefined,
      }));
  }

  private _reconstructFiscalCodeState(
    events: AuditEventSnapshot[],
    ragRetrievals: RAGRetrievalArtifact[],
  ): FiscalCodeState {
    // Use the earliest BOFiP version date found in any event payload
    const versionDates = [
      ...events.flatMap((e) =>
        typeof e.payload.bofip_version_date === "string"
          ? [e.payload.bofip_version_date]
          : [],
      ),
      ...ragRetrievals.flatMap((r) =>
        r.bofipVersionDate ? [r.bofipVersionDate] : [],
      ),
    ];

    const bofipVersionDate =
      versionDates.sort()[0] ?? events[0]?.createdAt.toISOString().slice(0, 10) ?? "unknown";

    // Collect unique BOFiP section IDs from RAG sources
    const sectionSet = new Set<string>();
    for (const retrieval of ragRetrievals) {
      for (const chunk of retrieval.chunks) {
        if (chunk.bofipId) sectionSet.add(chunk.bofipId);
      }
    }

    return {
      bofipVersionDate,
      relevantSections: Array.from(sectionSet).sort(),
      snapshotAt: new Date(),
    };
  }

  // ── Content builders ──────────────────────────────────────────────────────

  private _chunkToHtml(
    chunk: RAGChunk,
    retrieval: RAGRetrievalArtifact,
    idx: number,
  ): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>BOFiP Source #${idx} — ${chunk.title}</title>
</head>
<body>
  <h1>${chunk.title}</h1>
  <dl>
    <dt>URL</dt><dd><a href="${chunk.url}">${chunk.url}</a></dd>
    <dt>BOFiP ID</dt><dd>${chunk.bofipId ?? "n/a"}</dd>
    <dt>Score</dt><dd>${chunk.score.toFixed(4)}</dd>
    <dt>Query</dt><dd>${retrieval.query}</dd>
    <dt>Retrieved at</dt><dd>${retrieval.timestamp.toISOString()}</dd>
    <dt>BOFiP version</dt><dd>${retrieval.bofipVersionDate ?? "n/a"}</dd>
    <dt>Chunk index</dt><dd>${chunk.chunkIndex ?? "n/a"}</dd>
    <dt>Section</dt><dd>${chunk.sectionPath ?? "n/a"}</dd>
  </dl>
  <hr/>
  <pre>${chunk.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
  }

  private _buildReadme(bundle: ReplayBundle): string {
    return `STRATUS — REPLAY BUNDLE
======================
Entity  : ${bundle.entityType} / ${bundle.entityId}
Org     : ${bundle.orgId}
Generated: ${bundle.generatedAt.toISOString()}
Events  : ${bundle.events.length}
LLM calls: ${bundle.llmCalls.length}
RAG retrievals: ${bundle.ragRetrievals.length}
BOFiP version: ${bundle.fiscalCodeState.bofipVersionDate}
BOFiP sections: ${bundle.fiscalCodeState.relevantSections.join(", ") || "none"}

CONTENTS
--------
audit_log.jsonl        — Complete chronological audit trail (JSONL format).
                         Each line is a signed AuditEvent from the immutable DB table.

prompts/               — One file per LLM call.  Each file contains:
                         • The exact prompt sent (system + user messages)
                         • The model name, version, temperature
                         • The model's response
                         • The BOFiP sources injected as context

sources/               — One HTML file per BOFiP chunk retrieved.
                         Each file contains the exact text from the fiscal corpus
                         that was used to ground the AI's answer, with the
                         retrieval score and BOFiP version date.

declaration_xml.xml    — The generated EDI-TVA XML (or a pointer to its URL).

HOW TO USE FOR DGFiP AUDIT
---------------------------
1. Open audit_log.jsonl and verify the chronological sequence of agent actions.
2. For each LLM call in prompts/, confirm the prompt matches the expected CA3
   context and that the response is grounded in the BOFiP sources listed.
3. Compare sources/ against the official BOFiP publication at bofip.impots.gouv.fr
   for the version date shown above.
4. The declaration_xml.xml is the file that was (or would be) submitted to DGFiP.

For questions: audit@stratus.finance
`;
  }

  // ── Anthropic call ────────────────────────────────────────────────────────

  private async _callCurrentModel(prompt: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn("ANTHROPIC_API_KEY not set — returning stub re-run response");
      return `[Stub — ANTHROPIC_API_KEY not configured]\n\nPrompt received (${prompt.length} chars).\nSet ANTHROPIC_API_KEY to enable live re-run comparison with ${CURRENT_MODEL}.`;
    }

    try {
      // Dynamic import to avoid hard coupling when key is absent
      const { Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: CURRENT_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const block = msg.content[0];
      return block.type === "text" ? block.text : "";
    } catch (err) {
      this.logger.error("Anthropic re-run call failed", err);
      return `[Error during re-run: ${String(err)}]`;
    }
  }
}
