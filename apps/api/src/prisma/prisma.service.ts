import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "async_hooks";

// Tenant context shared across the request lifecycle via AsyncLocalStorage.
// Set by TenantInterceptor before the handler executes.
export const tenantStorage = new AsyncLocalStorage<{ orgId: string }>();

// Models that carry orgId and must be scoped to the current tenant.
const TENANT_MODELS = new Set([
  "FiscalClient",
  "FECImport",
  "FECEntry",
  "VATClassification",
  "CA3Declaration",
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    // Middleware: auto-inject orgId on every query for tenant-scoped models.
    // This is the safety net — service layer also checks ownership before writes.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — $use is deprecated in Prisma 6 but still functional
    this.$use(async (params: any, next: any) => {
      const store = tenantStorage.getStore();

      if (!store?.orgId || !params.model || !TENANT_MODELS.has(params.model)) {
        return next(params);
      }

      const { orgId } = store;
      params.args ??= {};

      switch (params.action) {
        // ── Reads: inject orgId into where ─────────────────────────────────
        case "findMany":
        case "findFirst":
        case "count":
        case "aggregate":
        case "groupBy":
          params.args.where = { ...params.args.where, orgId };
          break;

        // findUnique → rewrite to findFirst so we can add the non-unique orgId
        case "findUnique":
          params.action = "findFirst";
          params.args.where = { ...params.args.where, orgId };
          break;

        case "findUniqueOrThrow":
          params.action = "findFirstOrThrow";
          params.args.where = { ...params.args.where, orgId };
          break;

        // ── Creates: inject orgId into data ────────────────────────────────
        case "create":
          params.args.data = { ...params.args.data, orgId };
          break;

        case "createMany":
          if (Array.isArray(params.args.data)) {
            params.args.data = params.args.data.map((d: any) => ({
              ...d,
              orgId,
            }));
          }
          break;

        // ── Writes (update/delete): NOT intercepted here.
        // Service layer calls findFirst (tenant-scoped) before any write,
        // which guarantees ownership before the write proceeds.
        default:
          break;
      }

      return next(params);
    });

    await this.$connect();
  }
}
