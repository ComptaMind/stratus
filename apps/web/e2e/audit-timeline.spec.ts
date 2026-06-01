/**
 * Playwright E2E — Declaration Audit Timeline
 *
 * Prerequisites (run once):
 *   cd apps/web && pnpm add -D @playwright/test && npx playwright install chromium
 *
 * Run:
 *   cd apps/web && npx playwright test e2e/audit-timeline.spec.ts
 *
 * The test mocks the API responses via route interception so no real
 * backend or database is required.
 *
 * Scenarios:
 *   1. Navigation to /dashboard/declarations/:id/audit shows timeline
 *   2. Clicking an event card opens the event modal with payload
 *   3. Modal shows "Prompt / Réponse LLM" tab for LLM events
 *   4. Export button triggers download of replay-bundle
 */
import { test, expect, type Page, type Route } from "@playwright/test";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const DECLARATION_ID = "test-decl-e2e-001";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const MOCK_BUNDLE = {
  entityType: "CA3Declaration",
  entityId: DECLARATION_ID,
  orgId: "org-e2e",
  generatedAt: "2025-01-15T10:05:00Z",
  events: [
    {
      id: "evt-e2e-1",
      createdAt: "2025-01-15T10:00:00Z",
      actorType: "agent",
      actorId: "stratus-agent",
      action: "agent.transition",
      entityType: "CA3Declaration",
      entityId: DECLARATION_ID,
      payload: { from_state: "router", to_state: "ingest_fec", phase: "ingest" },
    },
    {
      id: "evt-e2e-2",
      createdAt: "2025-01-15T10:01:00Z",
      actorType: "agent",
      actorId: "stratus-agent",
      action: "handle_question",
      entityType: "CA3Declaration",
      entityId: DECLARATION_ID,
      payload: {
        prompt: "Quel est le taux de TVA pour la restauration ?",
        response: "Le taux applicable est 10 % (art. 279 a CGI).",
        model: "claude-haiku-4-5",
        model_version: "claude-haiku-4-5-20251001",
        temperature: 0.1,
        latency_ms: 820,
        sources: [
          {
            url: "https://bofip.impots.gouv.fr/BOI-TVA-LIQ-30",
            title: "BOI-TVA-LIQ-30 — Taux réduits restauration",
            text: "Le taux réduit de 10% s'applique aux ventes à emporter.",
            score: 0.92,
            bofip_id: "BOI-TVA-LIQ-30",
          },
        ],
      },
    },
    {
      id: "evt-e2e-3",
      createdAt: "2025-01-15T10:02:00Z",
      actorType: "agent",
      actorId: "stratus-agent",
      action: "declaration.computed",
      entityType: "CA3Declaration",
      entityId: DECLARATION_ID,
      payload: { lines: { L24: "1000.00", L15: "2000.00" } },
    },
  ],
  llmCalls: [
    {
      eventId: "evt-e2e-2",
      model: "claude-haiku-4-5",
      modelVersion: "claude-haiku-4-5-20251001",
      latencyMs: 820,
    },
  ],
  ragRetrievals: [],
  fiscalCodeState: {
    bofipVersionDate: "2024-12-15",
    relevantSections: ["BOI-TVA-LIQ-30"],
    snapshotAt: "2025-01-15T10:05:00Z",
  },
};

// ── Route interceptors ────────────────────────────────────────────────────────

async function mockReplayAPI(page: Page) {
  await page.route(
    `**/v1/declarations/${DECLARATION_ID}/replay`,
    (route: Route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_BUNDLE),
      });
    },
  );
}

async function mockReplayBundleDownload(page: Page) {
  await page.route(
    `**/v1/declarations/${DECLARATION_ID}/replay-bundle`,
    (route: Route) => {
      // Return minimal ZIP bytes (EOCD only — 22 bytes all zeros + correct sig)
      const eocd = Buffer.alloc(22);
      eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
      route.fulfill({
        status: 200,
        contentType: "application/zip",
        headers: {
          "Content-Disposition": `attachment; filename="stratus-replay-${DECLARATION_ID}.zip"`,
        },
        body: eocd.toString("binary"),
      });
    },
  );
}

async function mockClerkAuth(page: Page) {
  // Mock Clerk session so the dashboard layout doesn't redirect
  await page.addInitScript(() => {
    // Inject a minimal Clerk mock to bypass auth redirects in tests
    Object.defineProperty(window, "__clerk_frontend_api", {
      value: "clerk.test",
      writable: false,
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const AUDIT_URL = `${BASE_URL}/dashboard/declarations/${DECLARATION_ID}/audit`;

test.describe("Declaration Audit Timeline", () => {
  test.beforeEach(async ({ page }) => {
    await mockClerkAuth(page);
    await mockReplayAPI(page);
    await mockReplayBundleDownload(page);
  });

  test("shows audit trail page with event count in stats bar", async ({ page }) => {
    await page.goto(AUDIT_URL);

    // Page title
    await expect(
      page.getByRole("heading", { name: /journal d.audit/i }),
    ).toBeVisible();

    // Stats bar: should show event count
    await expect(page.getByText("Événements")).toBeVisible();
    await expect(page.getByText("3")).toBeVisible(); // 3 events in fixture
  });

  test("timeline displays all event cards", async ({ page }) => {
    await page.goto(AUDIT_URL);

    // Check each event's action name appears
    await expect(page.getByText("agent.transition")).toBeVisible();
    await expect(page.getByText("handle_question")).toBeVisible();
    await expect(page.getByText("declaration.computed")).toBeVisible();
  });

  test("LLM event card shows 'LLM prompt' badge", async ({ page }) => {
    await page.goto(AUDIT_URL);
    await expect(page.getByText("LLM prompt")).toBeVisible();
  });

  test("clicking an event card opens the modal with payload tab", async ({ page }) => {
    await page.goto(AUDIT_URL);

    // Click the first event card (agent.transition)
    const firstCard = page.getByRole("button", { name: /agent\.transition/ }).first();
    await firstCard.click();

    // Modal should appear with action in header
    await expect(page.getByRole("heading", { name: "agent.transition" })).toBeVisible();

    // Payload tab active by default — shows JSON
    await expect(page.getByText(/"from_state"/)).toBeVisible();
  });

  test("modal shows Prompt / Réponse LLM tab for LLM event", async ({ page }) => {
    await page.goto(AUDIT_URL);

    // Click the LLM event card (handle_question)
    const llmCard = page.getByRole("button", { name: /handle_question/ }).first();
    await llmCard.click();

    // Wait for modal
    await expect(page.getByRole("heading", { name: "handle_question" })).toBeVisible();

    // "Prompt / Réponse LLM" tab should be visible
    const promptTab = page.getByRole("button", { name: /Prompt \/ Réponse LLM/ });
    await expect(promptTab).toBeVisible();

    // Click it
    await promptTab.click();

    // Should now show the prompt text
    await expect(
      page.getByText(/Quel est le taux de TVA pour la restauration/),
    ).toBeVisible();

    // And the response
    await expect(
      page.getByText(/taux applicable est 10/),
    ).toBeVisible();
  });

  test("modal shows Sources BOFiP tab with chunk details", async ({ page }) => {
    await page.goto(AUDIT_URL);

    const llmCard = page.getByRole("button", { name: /handle_question/ }).first();
    await llmCard.click();

    const sourcesTab = page.getByRole("button", { name: /Sources BOFiP/ });
    await expect(sourcesTab).toBeVisible();
    await sourcesTab.click();

    // BOFiP section reference
    await expect(page.getByText(/BOI-TVA-LIQ-30/)).toBeVisible();
    // Score
    await expect(page.getByText(/0\.92/)).toBeVisible();
  });

  test("closing modal with × button removes it from DOM", async ({ page }) => {
    await page.goto(AUDIT_URL);

    const firstCard = page.getByRole("button", { name: /agent\.transition/ }).first();
    await firstCard.click();

    const modal = page.getByRole("heading", { name: "agent.transition" });
    await expect(modal).toBeVisible();

    // Click × close button
    await page.getByRole("button", { name: /fermer/i }).click();
    await expect(modal).not.toBeVisible();
  });

  test("export button triggers zip download", async ({ page }) => {
    await page.goto(AUDIT_URL);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /Exporter le bundle de replay/i }).click(),
    ]);

    expect(download.suggestedFilename()).toContain("stratus-replay");
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
  });

  test("BOFiP sections panel shows relevant sections", async ({ page }) => {
    await page.goto(AUDIT_URL);
    await expect(page.getByText("BOI-TVA-LIQ-30")).toBeVisible();
  });
});
