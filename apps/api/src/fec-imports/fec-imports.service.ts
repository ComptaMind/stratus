import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { CreateFecImportDto } from "./dto/create-fec-import.dto";
import { FEC_PARSE_QUEUE, FecParseJobData } from "../fec/fec-parse.processor";
import { FEC_VAT_CLASSIFY_QUEUE, FecVatClassifyJobData } from "../fec/fec-vat-classify.processor";

@Injectable()
export class FecImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @InjectQueue(FEC_PARSE_QUEUE) private readonly parseQueue: Queue,
    @InjectQueue(FEC_VAT_CLASSIFY_QUEUE) private readonly classifyQueue: Queue
  ) {}

  findAll() {
    return this.prisma.fECImport.findMany({
      orderBy: { createdAt: "desc" },
      include: { fiscalClient: { select: { name: true } } },
    });
  }

  findOne(id: string) {
    return this.prisma.fECImport.findFirst({ where: { id } });
  }

  async findOneOrFail(id: string) {
    const item = await this.findOne(id);
    if (!item) throw new NotFoundException("FECImport not found");
    return item;
  }

  /**
   * Upload FEC file to storage, create DB record, emit audit event.
   * Returns { import_id, upload_url }.
   */
  async create(
    dto: CreateFecImportDto,
    file: Express.Multer.File,
    orgId: string,
    actorId: string
  ) {
    const key = `fec/${orgId}/${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const uploadUrl = await this.storage.upload(key, file.buffer, file.mimetype || "text/plain");

    const fecImport = await this.prisma.fECImport.create({
      data: {
        fiscalClientId: dto.fiscalClientId,
        filename: file.originalname,
        fileUrl: uploadUrl,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        periodType: dto.periodType,
        uploadedByUserId: actorId,
        // orgId auto-injected by Prisma tenant middleware
      } as any,
    });

    await this.audit.log({
      orgId,
      actorType: "user",
      actorId,
      action: "fec.upload",
      entityType: "FECImport",
      entityId: fecImport.id,
      payload: {
        filename: file.originalname,
        fiscalClientId: dto.fiscalClientId,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        periodType: dto.periodType,
        fileSize: file.size,
        uploadUrl,
      },
    });

    return { import_id: fecImport.id, upload_url: uploadUrl };
  }

  /**
   * Enqueue async BullMQ parse job for the given import.
   */
  async triggerParse(importId: string, orgId: string, actorId: string) {
    const fecImport = await this.findOneOrFail(importId);

    if (fecImport.status === "parsed") {
      return { status: "already_parsed", import_id: importId };
    }

    const jobData: FecParseJobData = { importId, orgId, actorId };
    const job = await this.parseQueue.add("parse", jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });

    return { status: "queued", import_id: importId, job_id: job.id };
  }

  /**
   * Enqueue async BullMQ VAT classification job for the given import.
   */
  async triggerClassify(importId: string, orgId: string, actorId: string) {
    const fecImport = await this.findOneOrFail(importId);

    if (fecImport.status === "classified") {
      return { status: "already_classified", import_id: importId };
    }

    const jobData: FecVatClassifyJobData = { importId, orgId, actorId };
    const job = await this.classifyQueue.add("classify", jobData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    });

    return { status: "queued", import_id: importId, job_id: job.id };
  }

  /**
   * Return all VATClassification rows for the given import.
   */
  async getClassifications(importId: string) {
    return this.prisma.vATClassification.findMany({
      where: { fecEntry: { fecImportId: importId } },
      include: {
        fecEntry: {
          select: {
            ecritureNum: true,
            compteNum: true,
            compteLib: true,
            ecritureLib: true,
            debit: true,
            credit: true,
          },
        },
      },
      orderBy: [
        { fecEntry: { ecritureNum: "asc" } },
        { fecEntry: { compteNum: "asc" } },
      ],
    });
  }
}
