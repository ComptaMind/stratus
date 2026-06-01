import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<{
    status: "ok" | "degraded";
    version: string;
    checks: Record<string, "ok" | "fail">;
    uptime_s: number;
  }> {
    const checks: Record<string, "ok" | "fail"> = {};

    // ── Database probe ────────────────────────────────────────────────────────
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch (err) {
      this.logger.error("DB health check failed", err);
      checks.database = "fail";
    }

    const allOk = Object.values(checks).every((v) => v === "ok");

    return {
      status: allOk ? "ok" : "degraded",
      version: process.env.npm_package_version ?? "0.0.0",
      checks,
      uptime_s: Math.floor(process.uptime()),
    };
  }
}
