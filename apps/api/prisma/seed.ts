import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // 1. Create a demo Organization (cabinet comptable)
  const org = await prisma.organization.upsert({
    where: { clerkOrgId: "seed_demo_org" },
    update: {},
    create: {
      clerkOrgId: "seed_demo_org",
      name: "Cabinet Dupont & Associés",
      countryDefault: "FR",
      vatRegimeDefault: "réel normal",
      siret: "12345678900012",
      siren: "123456789",
    },
  });
  console.log(`  Organization: ${org.name} (${org.id})`);

  // 2. Create a demo FiscalClient (PME cliente du cabinet)
  const client = await prisma.fiscalClient.upsert({
    where: { id: "seed_demo_client" },
    update: {},
    create: {
      id: "seed_demo_client",
      orgId: org.id,
      name: "Boulangerie Martin SAS",
      siren: "987654321",
      vatNumber: "FR12987654321",
      vatRegime: "réel normal",
      country: "FR",
      fiscalYearStart: "01-01",
    },
  });
  console.log(`  FiscalClient: ${client.name} (${client.id})`);

  console.log("Seed complete. 0 FEC imports (per spec).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
