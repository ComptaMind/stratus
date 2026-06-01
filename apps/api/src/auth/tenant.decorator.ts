import { applyDecorators, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "./clerk.guard";
import { TenantGuard } from "./tenant.guard";

/**
 * Composite decorator for tenant-scoped controllers and handlers.
 * Applies Clerk JWT verification + tenant loading in one decorator.
 * The TenantInterceptor (applied globally) picks up req.orgId and seeds
 * the Prisma AsyncLocalStorage context for the duration of the request.
 *
 * Usage:
 *   @Controller('fiscal-clients')
 *   @TenantScoped()
 *   export class FiscalClientsController { ... }
 */
export const TenantScoped = () =>
  applyDecorators(UseGuards(ClerkAuthGuard, TenantGuard));
