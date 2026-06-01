import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

export const FEC_VAT_CLASSIFY_QUEUE = "fec-vat-classify";

export interface FecVatClassifyJobData {
  importId: string;
  orgId: string;
  actorId: string;
}

interface AgentClassifyResult {
  ecriture_num: string;
  compte_num: string;
  compte_lib: string;
  ecriture_lib: string;
  debit: number;
  credit: number;
  vat_type: string;
  confidence: number;
  method: "rule" | "llm";
  llm_reasoning: string | null;
  error: string | null;
}

interface AgentClassifyResponse {
  import_id: string;
  total_entries: number;
  classified: number;
  results: AgentClassifyResult[];
}

// Scope: accounts that can carry VAT
function isVatScope(compteNum: string): boolean {
  return (
    compteNum.startsWith("44") ||
    compteNum.startsWith("6") ||
    compteNum.startsWith("7")
  );
}

// For 44x accounts the amount IS the TVA; for 6/7 it is the base HT
function extractAmounts(
  compteNum: string,
  debit: number,
  credit: number
): { baseHt: number; tvaAmount: number } {
  const amount = Math.max(debit, credit);
  if (compteNum.startsWith("44")) {
    return { baseHt: 0, tvaAmount: amount };
  }
  return { baseHt: amount, tvaAmount: 0 };
}

@Processor(FEC_VAT_CLASSIFY_QUEUE)
export class FecVatClassifyProcessor extends WorkerHost {
  private readonly logger = new Logger(FecVatClassifyProcessor.name);
  private readonly agentUrl =
    process.env.AGENT_URL ?? "http://localhost:8000";

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {
    super();
  }

  async process(job: Job<FecVatClassifyJobData>): Promise<void> {
    const { importId, orgId, actorId } = job.data;
    this.logger.log(`VAT classify job started for import ${importId}`);

    // 1 — Fetch in-scope FEC entries from DB
    const entries = await this.prisma.fECEntry.findMany({
      where: { fecImportId: importId },
      select: {
        id: true,
        ecritureNum: true,
        compteNum: true,
        compteLib: true,
        ecritureLib: true,
        debit: true,
        credit: true,
        journalCode: true,
        pieceRef: true,
      },
    });

    const inScope = entries.filter((e) => isVatScope(e.compteNum));
    if (inScope.length === 0) {
      this.logger.log(`No in-scope entries for import ${importId}`);
      await this.prisma.fECImport.update({
        where: { id: importId },
        data: { status: "classified" },
      });
      return;
    }

    // 2 — Call Python agent
    const requestBody = {
      entries: inScope.map((e) => ({
        ecriture_num: e.ecritureNum,
        compte_num: e.compteNum,
        compte_lib: e.compteLib,
        ecriture_lib: e.ecritureLib,
        debit: Number(e.debit),
        credit: Number(e.credit),
        journal_code: e.journalCode,
        piece_ref: e.pieceRef ?? "",
      })),
      organization_id: orgId,
      session_id: importId,
    };

    let agentResponse: AgentClassifyResponse;
    try {
      const res = await fetch(
        `${this.agentUrl}/v1/fec-imports/${importId}/classify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120_000),
        }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Agent returned ${res.status}: ${body}`);
      }
      agentResponse = (await res.json()) as AgentClassifyResponse;
    } catch (err) {
      this.logger.error(`Agent call failed for ${importId}: ${err}`);
      await this.prisma.fECImport.update({
        where: { id: importId },
        data: { status: "failed", errorMessage: `VAT classify failed: ${err}` },
      });
      throw err;
    }

    // 3 — Build entry id lookup map (ecritureNum + compteNum → id)
    const entryLookup = new Map<string, string>();
    for (const e of inScope) {
      entryLookup.set(`${e.ecritureNum}|${e.compteNum}`, e.id);
    }

    // 4 — Upsert VATClassification rows in Prisma
    let classifiedCount = 0;
    for (const r of agentResponse.results) {
      if (r.error) continue;
      const key = `${r.ecriture_num}|${r.compte_num}`;
      const entryId = entryLookup.get(key);
      if (!entryId) continue;

      const { baseHt, tvaAmount } = extractAmounts(
        r.compte_num,
        r.debit,
        r.credit
      );

      await this.prisma.vATClassification.upsert({
        where: { fecEntryId: entryId },
        create: {
          orgId,
          fecEntryId: entryId,
          vatType: r.vat_type,
          baseHt,
          tvaAmount,
          confidence: r.confidence,
          modelUsed: r.method === "rule" ? "rule-engine" : "claude-haiku-4-5-20251001",
          reasoning: r.llm_reasoning ?? "",
        },
        update: {
          vatType: r.vat_type,
          baseHt,
          tvaAmount,
          confidence: r.confidence,
          modelUsed: r.method === "rule" ? "rule-engine" : "claude-haiku-4-5-20251001",
          reasoning: r.llm_reasoning ?? "",
        },
      });
      classifiedCount++;
    }

    // 5 — Update FECImport status
    await this.prisma.fECImport.update({
      where: { id: importId },
      data: { status: "classified" },
    });

    // 6 — Audit event
    await this.audit.log({
      orgId,
      actorType: "system",
      actorId,
      action: "entry.classified",
      entityType: "FECImport",
      entityId: importId,
      payload: {
        import_id: importId,
        in_scope_entries: inScope.length,
        classified: classifiedCount,
        agent_total: agentResponse.classified,
      },
    });

    this.logger.log(
      `VAT classify complete: ${classifiedCount}/${inScope.length} entries for import ${importId}`
    );
  }
}
