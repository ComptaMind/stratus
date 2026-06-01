/**
 * Audit Replay controller.
 *
 * All routes are scoped to /v1/declarations/:id because for MVP the
 * primary replay use case is CA3Declaration review.  The underlying
 * AuditService.replay() accepts any entityType, so extension to other
 * entity types (FECImport, VATClassification) is trivial.
 *
 * Routes:
 *   GET  /v1/declarations/:id/replay          — full ReplayBundle (JSON)
 *   GET  /v1/declarations/:id/replay-bundle   — ZIP archive download
 *   POST /v1/declarations/:id/replay-llm/:eid — re-run LLM call with current model
 *
 * Auth: ClerkAuthGuard + TenantGuard (orgId injected from JWT).
 * PRD reference: §5.1 "Replay & Auditability".
 */
import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { ClerkAuthGuard } from "../auth/clerk.guard";
import { TenantGuard } from "../auth/tenant.guard";
import { Tenant } from "../auth/tenant.decorator";
import { AuditService } from "./audit.service";
import type { LLMRerunResult, ReplayBundle } from "./replay.types";

@Controller("v1/declarations")
@UseGuards(ClerkAuthGuard, TenantGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * GET /v1/declarations/:id/replay
   *
   * Returns the full ReplayBundle as JSON.
   * Used by the frontend timeline page.
   */
  @Get(":id/replay")
  async getReplay(
    @Param("id") id: string,
    @Tenant("orgId") orgId: string,
  ): Promise<ReplayBundle> {
    return this.audit.replay("CA3Declaration", id, orgId);
  }

  /**
   * GET /v1/declarations/:id/replay-bundle
   *
   * Streams a ZIP archive for download.
   * Content-Disposition: attachment triggers browser save-as dialog.
   * File size note: typically 10–200 kB per declaration.
   */
  @Get(":id/replay-bundle")
  async downloadReplayBundle(
    @Param("id") id: string,
    @Tenant("orgId") orgId: string,
    @Res() res: Response,
  ): Promise<void> {
    const zip = await this.audit.exportReplayBundle("CA3Declaration", id, orgId);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="stratus-replay-${id}.zip"`,
    );
    res.setHeader("Content-Length", zip.length);
    res.setHeader("Cache-Control", "no-store");
    res.end(zip);
  }

  /**
   * POST /v1/declarations/:id/replay-llm/:eventId
   *
   * Re-runs the archived LLM prompt with the current Claude model.
   * Returns side-by-side comparison: original response vs current response.
   * Requires ANTHROPIC_API_KEY env var (degrades gracefully to stub if absent).
   */
  @Post(":id/replay-llm/:eventId")
  @HttpCode(HttpStatus.OK)
  async rerunWithCurrentModel(
    @Param("id") id: string,
    @Param("eventId") eventId: string,
    @Tenant("orgId") orgId: string,
  ): Promise<LLMRerunResult> {
    return this.audit.rerunWithCurrentModel(
      "CA3Declaration",
      id,
      orgId,
      eventId,
    );
  }
}
