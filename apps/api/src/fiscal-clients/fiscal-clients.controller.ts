import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  NotFoundException,
} from "@nestjs/common";
import { FiscalClientsService } from "./fiscal-clients.service";
import { CreateFiscalClientDto } from "./dto/create-fiscal-client.dto";
import { UpdateFiscalClientDto } from "./dto/update-fiscal-client.dto";
import { TenantScoped } from "../auth/tenant.decorator";
import { TenantRequest } from "../auth/request-context.interface";

@Controller("fiscal-clients")
@TenantScoped()
export class FiscalClientsController {
  constructor(private readonly service: FiscalClientsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    const client = await this.service.findOne(id);
    // Return 404 (not 403) to prevent resource enumeration across tenants.
    if (!client) throw new NotFoundException();
    return client;
  }

  @Post()
  create(@Body() dto: CreateFiscalClientDto, @Req() req: TenantRequest) {
    return this.service.create(dto, req.orgId!, req.tenantUser!.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateFiscalClientDto,
    @Req() req: TenantRequest
  ) {
    return this.service.update(id, dto, req.orgId!, req.tenantUser!.id);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: TenantRequest) {
    return this.service.remove(id, req.orgId!, req.tenantUser!.id);
  }
}
