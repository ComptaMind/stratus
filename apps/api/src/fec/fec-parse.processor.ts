import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { FECParserService, FECParseError, FECRow } from "./fec-parser.service";

export const FEC_PARSE_QUEUE = "fec-parse";

export interface FecParseJobData {
  importId: string;
  orgId: string;
  actorId: string;
}

@Processor(FEC_PARSE_QUEUE)
export class FecParseProcessor extends WorkerHost {
  private readonly logger = new Logger(FecParseProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly parser: FECParserService
  ) {
    super();
  }

  async process(job: Job<FecParseJobData>): Promise<void> {
    const { importId, orgId, actorId } = job.data;
    this.logger.log(`Processing FEC parse job for import ${importId}`);

    // Fetch the FECImport record
    const fecImport = await this.prisma.fECImport.findFirst({
      where: { id: importId },
    });
    if (!fecImport) {
      this.logger.error(`FECImport ${importId} not found`);
      return;
    }

    try {
      // Download file from storage
      const buffer = await this.storage.download(fecImport.fileUrl);

      // Parse
      const result = this.parser.parse(
        buffer,
        fecImport.periodStart,
        fecImport.periodEnd
      );

      // Bulk insert FECEntry rows in batches of 1000
      const BATCH_SIZE = 1000;
      for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
        const batch = result.rows.slice(i, i + BATCH_SIZE);
        await this.prisma.fECEntry.createMany({
          data: batch.map((row: FECRow) => ({
            orgId,
            fecImportId: importId,
            journalCode: row.journalCode,
            journalLib: row.journalLib,
            ecritureNum: row.ecritureNum,
            ecritureDate: row.ecritureDate,
            compteNum: row.compteNum,
            compteLib: row.compteLib,
            compAuxNum: row.compAuxNum,
            compAuxLib: row.compAuxLib,
            pieceRef: row.pieceRef,
            pieceDate: row.pieceDate,
            ecritureLib: row.ecritureLib,
            debit: row.debit,
            credit: row.credit,
            lettrage: row.lettrage,
            dateLet: row.dateLet,
            validDate: row.validDate,
            montantDevise: row.montantDevise,
            codeDevise: row.codeDevise,
          })),
        });
      }

      // Update FECImport status
      await this.prisma.fECImport.update({
        where: { id: importId },
        data: {
          status: "parsed",
          entriesCount: result.rows.length,
          errorMessage: null,
        },
      });

      // Emit audit event
      await this.audit.log({
        orgId,
        actorType: "system",
        actorId,
        action: "fec.parsed",
        entityType: "FECImport",
        entityId: importId,
        payload: {
          import_id: importId,
          entries_count: result.rows.length,
          balance_check: result.balanceOk,
          total_debit: result.totalDebit,
          total_credit: result.totalCredit,
          separator: result.separator,
          encoding: result.encoding,
          parser_version: result.parserVersion,
        },
      });

      this.logger.log(
        `FEC parsed: ${result.rows.length} entries for import ${importId}`
      );
    } catch (err) {
      const message =
        err instanceof FECParseError
          ? err.message
          : `Unexpected error: ${(err as Error).message}`;

      this.logger.error(`FEC parse failed for ${importId}: ${message}`);

      await this.prisma.fECImport.update({
        where: { id: importId },
        data: { status: "failed", errorMessage: message },
      });
    }
  }
}
