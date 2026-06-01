import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateFiscalClientDto } from "./dto/create-fiscal-client.dto";
import { UpdateFiscalClientDto } from "./dto/update-fiscal-client.dto";

@Injectable()
export class FiscalClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  findAll() {
    // Prisma middleware auto-injects orgId via tenantStorage.
    return this.prisma.fiscalClient.findMany({ orderBy: { name: "asc" } });
  }

  findOne(id: string) {
    // findFirst (rewritten from findUnique by middleware) adds orgId to where.
    // Returns null if id belongs to a different org → controller returns 404.
    return this.prisma.fiscalClient.findFirst({ where: { id } });
  }

  async create(dto: CreateFiscalClientDto, orgId: string, actorId: string) {
    // Middleware injects orgId into data automatically.
    const client = await this.prisma.fiscalClient.create({ data: dto as any });

    await this.audit.log({
      orgId,
      actorType: "user",
      actorId,
      action: "fiscal_client.created",
      entityType: "FiscalClient",
      entityId: client.id,
      payload: { name: dto.name, vatRegime: dto.vatRegime },
    });

    return client;
  }

  async update(
    id: string,
    dto: UpdateFiscalClientDto,
    orgId: string,
    actorId: string
  ) {
    // Ownership check: findOne adds orgId filter via middleware.
    const existing = await this.findOne(id);
    if (!existing) throw new NotFoundException("FiscalClient not found");

    const updated = await this.prisma.fiscalClient.update({
      where: { id },
      data: dto,
    });

    await this.audit.log({
      orgId,
      actorType: "user",
      actorId,
      action: "fiscal_client.updated",
      entityType: "FiscalClient",
      entityId: id,
      payload: { changes: dto },
    });

    return updated;
  }

  async remove(id: string, orgId: string, actorId: string) {
    const existing = await this.findOne(id);
    if (!existing) throw new NotFoundException("FiscalClient not found");

    await this.prisma.fiscalClient.delete({ where: { id } });

    await this.audit.log({
      orgId,
      actorType: "user",
      actorId,
      action: "fiscal_client.deleted",
      entityType: "FiscalClient",
      entityId: id,
      payload: {},
    });

    return { deleted: true, id };
  }
}
