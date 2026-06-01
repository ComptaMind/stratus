/**
 * Enderix Finance onboarding seed
 *
 * Provisions:
 *   - Organization: Enderix Finance
 *   - Admin user: Anne-Carla Kamgang (clerk user ID from env)
 *   - FiscalClient: Enderix Finance SAS
 *   - 3 months of FEC imports (stubs — real files provided separately)
 *
 * Usage:
 *   CLERK_ORG_ID=org_xxx CLERK_USER_ID=user_xxx \
 *   DATABASE_URL=postgresql://... \
 *   pnpm tsx apps/api/prisma/seed-enderix.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_CLERK_ID  = process.env.CLERK_ORG_ID  ?? "org_enderix_prod";
const USER_CLERK_ID = process.env.CLERK_USER_ID ?? "user_ackamgang";

async function main() {
  console.log("=== Enderix Finance onboarding seed ===\n");

  // ── 1. Organization ──────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { clerkOrgId: ORG_CLERK_ID },
    update: { name: "Enderix Finance" },
    create: {
      clerkOrgId:       ORG_CLERK_ID,
      name:             "Enderix Finance",
      countryDefault:   "FR",
      vatRegimeDefault: "réel normal",
      siret:            "90000000000012",  // replace with real SIRET before prod
      siren:            "900000000",
    },
  });
  console.log(`[1/4] Organization : ${org.name}  (id=${org.id})`);

  // ── 2. Membership (admin role) ───────────────────────────────────────────────
  const membership = await prisma.membership.upsert({
    where: {
      orgId_clerkUserId: {
        orgId:       org.id,
        clerkUserId: USER_CLERK_ID,
      },
    },
    update: { role: "admin" },
    create: {
      orgId:       org.id,
      clerkUserId: USER_CLERK_ID,
      role:        "admin",
    },
  });
  console.log(`[2/4] Membership   : clerkUserId=${membership.clerkUserId}  role=${membership.role}`);

  // ── 3. FiscalClient ──────────────────────────────────────────────────────────
  const client = await prisma.fiscalClient.upsert({
    where: { id: "enderix-finance-sas" },
    update: {},
    create: {
      id:             "enderix-finance-sas",
      orgId:          org.id,
      name:           "Enderix Finance SAS",
      siren:          "900000000",
      vatNumber:      "FR00900000000",
      vatRegime:      "réel normal",
      country:        "FR",
      fiscalYearStart: "01-01",
    },
  });
  console.log(`[3/4] FiscalClient : ${client.name}  (id=${client.id})`);

  // ── 4. FEC import stubs (3 months) ───────────────────────────────────────────
  // These are placeholder records — the real FEC files are uploaded via the UI
  // or via POST /v1/fec-imports after this seed runs.
  const months = [
    { period_start: "2024-10-01", period_end: "2024-10-31", label: "Oct 2024" },
    { period_start: "2024-11-01", period_end: "2024-11-30", label: "Nov 2024" },
    { period_start: "2024-12-01", period_end: "2024-12-31", label: "Dec 2024" },
  ];

  for (const m of months) {
    const existing = await prisma.fECImport.findFirst({
      where: {
        fiscalClientId: client.id,
        periodStart:    new Date(m.period_start),
      },
    });
    if (existing) {
      console.log(`[4/4] FECImport    : ${m.label} already exists (id=${existing.id}) — skipped`);
      continue;
    }

    const fec = await prisma.fECImport.create({
      data: {
        fiscalClientId: client.id,
        orgId:          org.id,
        periodStart:    new Date(m.period_start),
        periodEnd:      new Date(m.period_end),
        filename:       `FEC_Enderix_${m.period_start.slice(0, 7).replace("-", "")}.txt`,
        rowCount:       0,       // updated when the real file is processed
        status:         "pending",
      },
    });
    console.log(`[4/4] FECImport    : ${m.label}  (id=${fec.id}  status=pending)`);
  }

  console.log("\n=== Seed complete ===");
  console.log("Next steps:");
  console.log("  1. Upload the 3 real FEC files via the dashboard or:");
  console.log("     POST /v1/fec-imports  (multipart/form-data, field=file)");
  console.log("  2. Trigger classification for each import:");
  console.log("     POST /v1/fec-imports/:id/classify");
  console.log("  3. Compute CA3 for each declaration:");
  console.log("     POST /v1/declarations  (body: { fec_import_id, period_type: 'monthly' })");
  console.log("  4. Review in the dashboard at /dashboard/clients/enderix-finance-sas");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
