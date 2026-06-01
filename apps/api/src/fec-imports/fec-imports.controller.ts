import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FecImportsService } from "./fec-imports.service";
import { CreateFecImportDto } from "./dto/create-fec-import.dto";
import { TenantScoped } from "../auth/tenant.decorator";
import { TenantRequest } from "../auth/request-context.interface";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

@Controller("v1/fec-imports")
@TenantScoped()
export class FecImportsController {
  constructor(private readonly service: FecImportsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(":id")
  async findOne(@Param("id") id: string) {
    const item = await this.service.findOne(id);
    if (!item) throw new NotFoundException();
    return item;
  }

  /**
   * POST /v1/fec-imports
   * Accepts multipart/form-data: file + fiscalClientId + periodStart + periodEnd + periodType
   * Returns { import_id, upload_url }
   */
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        const allowed = [".txt", ".csv"];
        const ext = file.originalname.slice(file.originalname.lastIndexOf(".")).toLowerCase();
        if (allowed.includes(ext)) {
          cb(null, true);
        } else {
          cb(new BadRequestException("Only .txt and .csv files are accepted"), false);
        }
      },
    })
  )
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { fiscalClientId: string; periodStart: string; periodEnd: string; periodType: string },
    @Req() req: TenantRequest
  ) {
    if (!file) throw new BadRequestException("No file uploaded");

    const dto: CreateFecImportDto = {
      fiscalClientId: body.fiscalClientId,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      periodType: body.periodType as "mensuelle" | "trimestrielle",
    };

    return this.service.create(dto, file, req.orgId!, req.tenantUser!.id);
  }

  /**
   * POST /v1/fec-imports/:id/parse
   * Enqueues async BullMQ parse job.
   * Returns { status: 'queued', import_id, job_id }
   */
  @Post(":id/parse")
  async parse(@Param("id") id: string, @Req() req: TenantRequest) {
    const item = await this.service.findOne(id);
    if (!item) throw new NotFoundException();
    return this.service.triggerParse(id, req.orgId!, req.tenantUser!.id);
  }

  /**
   * POST /v1/fec-imports/:id/classify
   * Enqueues async BullMQ VAT classification job.
   * Returns { status: 'queued', import_id, job_id }
   */
  @Post(":id/classify")
  async classify(@Param("id") id: string, @Req() req: TenantRequest) {
    const item = await this.service.findOne(id);
    if (!item) throw new NotFoundException();
    return this.service.triggerClassify(id, req.orgId!, req.tenantUser!.id);
  }

  /**
   * GET /v1/fec-imports/:id/classifications
   * Returns all VATClassification rows for this import.
   */
  @Get(":id/classifications")
  async getClassifications(@Param("id") id: string) {
    const item = await this.service.findOne(id);
    if (!item) throw new NotFoundException();
    return this.service.getClassifications(id);
  }
}
