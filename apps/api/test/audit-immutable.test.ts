/**
 * AuditEvent immutability test.
 *
 * Verifies that the PostgreSQL trigger prevents UPDATE and DELETE
 * on the audit_events table at the database level.
 * Uses a real DB connection (requires DATABASE_URL in .env).
 */
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

afterAll(() => prisma.$disconnect());

describe("AuditEvent immutability (DB trigger — FOR EACH STATEMENT)", () => {
  it("rejects UPDATE on audit_events, even with no matching rows", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_events SET "actorId" = 'hacked' WHERE "actorId" = '__will_never_match__'`
      )
    ).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE from audit_events, even with no matching rows", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM audit_events WHERE "actorId" = '__will_never_match__'`
      )
    ).rejects.toThrow(/append-only/);
  });
});
