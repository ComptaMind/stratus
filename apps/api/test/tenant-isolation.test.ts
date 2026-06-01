/**
 * Tenant isolation test.
 *
 * Verifies that a user from org-A receives 404 (not 403) when requesting
 * a FiscalClient that belongs to org-B, preventing resource enumeration.
 */
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, CanActivate, ExecutionContext } from "@nestjs/common";
import supertest from "supertest";
import { FiscalClientsController } from "../src/fiscal-clients/fiscal-clients.controller";
import { FiscalClientsService } from "../src/fiscal-clients/fiscal-clients.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { ClerkAuthGuard } from "../src/auth/clerk.guard";
import { TenantGuard } from "../src/auth/tenant.guard";
import { TenantInterceptor } from "../src/auth/tenant.interceptor";
import { AuditService } from "../src/audit/audit.service";

// ── Mock guards ───────────────────────────────────────────────────────────────

class MockClerkGuard implements CanActivate {
  canActivate() {
    return true;
  }
}

/** Simulates a request authenticated as a user from org-a. */
class MockTenantGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    req.orgId = "org-a";
    req.tenantUser = {
      id: "user-1",
      orgId: "org-a",
      clerkUserId: "clerk-1",
      email: "a@example.com",
    };
    return true;
  }
}

// ── Mock Prisma (no real DB needed) ──────────────────────────────────────────

const mockPrisma = {
  fiscalClient: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  auditEvent: { create: vi.fn().mockResolvedValue({}) },
};

const mockAudit = { log: vi.fn().mockResolvedValue(undefined) };

// ── Test suite ────────────────────────────────────────────────────────────────

describe("Tenant isolation — FiscalClients", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // Provide the controller + service + mocked deps directly (no module import)
      // so DI doesn't need global modules (PrismaModule, AuditModule).
      controllers: [FiscalClientsController],
      providers: [
        FiscalClientsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useClass(MockClerkGuard)
      .overrideGuard(TenantGuard)
      .useClass(MockTenantGuard)
      .compile();

    app = module.createNestApplication();
    app.useGlobalInterceptors(new TenantInterceptor());
    await app.init();
  });

  afterAll(() => app.close());

  it("GET /fiscal-clients/:id → 404 (not 403) for a cross-tenant ID", async () => {
    // Mock returns null — simulates Prisma middleware blocking cross-tenant access.
    mockPrisma.fiscalClient.findFirst.mockResolvedValue(null);

    const res = await supertest(app.getHttpServer()).get(
      "/fiscal-clients/id-from-org-b"
    );

    expect(res.status).toBe(404);
    // MUST NOT be 403 — that would reveal the resource exists in another tenant.
    expect(res.status).not.toBe(403);
  });

  it("GET /fiscal-clients/:id → 200 for own-tenant ID", async () => {
    mockPrisma.fiscalClient.findFirst.mockResolvedValue({
      id: "client-1",
      orgId: "org-a",
      name: "Test SA",
      vatRegime: "réel normal",
      country: "FR",
      fiscalYearStart: "01-01",
      siren: null,
      vatNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await supertest(app.getHttpServer()).get(
      "/fiscal-clients/client-1"
    );

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("client-1");
  });
});
