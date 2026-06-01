/**
 * E2E: Full dashboard flow
 * Upload FEC → classify → chat → compute CA3 → download XML
 *
 * All API calls are mocked via page.route() — no real backend needed.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const CLIENT_ID = "client-e2e-1";
const IMPORT_ID = "import-e2e-1";
const DECL_ID   = "decl-e2e-1";

const MOCK_CLIENT = {
  id: CLIENT_ID,
  org_id: "org-1",
  name: "Acme SAS",
  siret: "12345678901234",
  period_type: "monthly",
  status: "up_to_date",
  next_deadline: "2025-02-15",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  last_declaration: {
    id: DECL_ID,
    period_start: "2025-01-01",
    period_end: "2025-01-31",
    status: "validated",
    tva_nette: 1200,
  },
};

const MOCK_IMPORT: object = {
  id: IMPORT_ID,
  fiscal_client_id: CLIENT_ID,
  filename: "FEC_202501.txt",
  status: "uploaded",
  rows_count: 500,
  created_at: "2025-02-01T10:00:00Z",
  updated_at: "2025-02-01T10:00:00Z",
};

const MOCK_DECLARATION = {
  id: DECL_ID,
  fiscal_client_id: CLIENT_ID,
  org_id: "org-1",
  period_start: "2025-01-01",
  period_end: "2025-01-31",
  period_type: "monthly",
  status: "draft",
  ca_ht_20: 10000,
  tva_20: 2000,
  tva_collectee: 2000,
  tva_deductible_services: 800,
  tva_deductible_total: 800,
  tva_nette: 1200,
  net_a_payer: 1200,
  created_at: "2025-02-01T10:00:00Z",
  updated_at: "2025-02-01T10:00:00Z",
};

// ── Mock setup helpers ───────────────────────────────────────────────────────

async function setupMocks(page: import("@playwright/test").Page) {
  // Clerk auth — always authenticated in E2E
  await page.route("**/api/clerk/**", route => route.fulfill({ status: 200, body: "{}" }));

  // Fiscal clients list
  await page.route("**/fiscal-clients", async route => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ json: [MOCK_CLIENT] });
    } else if (method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}");
      await route.fulfill({ json: { ...MOCK_CLIENT, id: "client-new", name: body.name } });
    } else {
      await route.continue();
    }
  });

  // Single client
  await page.route(`**/fiscal-clients/${CLIENT_ID}`, route =>
    route.fulfill({ json: MOCK_CLIENT }),
  );

  // FEC imports list
  await page.route(`**/fec-imports?fiscal_client_id=${CLIENT_ID}`, route =>
    route.fulfill({ json: [MOCK_IMPORT] }),
  );

  // FEC import upload
  await page.route("**/v1/fec-imports", async route => {
    const method = route.request().method();
    if (method === "POST") {
      await route.fulfill({ json: { ...MOCK_IMPORT, id: "import-new" } });
    } else {
      await route.fulfill({ json: [MOCK_IMPORT] });
    }
  });

  // Classify
  await page.route(`**/fec-imports/${IMPORT_ID}/classify`, route =>
    route.fulfill({ json: { status: "classifying" } }),
  );

  // Declarations list
  await page.route(`**/declarations?fiscal_client_id=${CLIENT_ID}`, route =>
    route.fulfill({ json: [MOCK_DECLARATION] }),
  );

  // Single declaration
  await page.route(`**/v1/declarations/${DECL_ID}`, route =>
    route.fulfill({ json: MOCK_DECLARATION }),
  );

  // Validate declaration
  await page.route(`**/declarations/${DECL_ID}/validate`, route =>
    route.fulfill({ json: { ...MOCK_DECLARATION, status: "validated" } }),
  );

  // XML / replay-bundle download
  await page.route(`**/declarations/${DECL_ID}/replay-bundle`, route =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/xml" },
      body: "<?xml version=\"1.0\"?><Echange/>",
    }),
  );

  // Agent session
  await page.route("**/v1/agent/sessions", route =>
    route.fulfill({ json: { session_id: "sess-1", phase: "idle" } }),
  );

  // Agent state
  await page.route("**/v1/agent/sessions/sess-1/state", route =>
    route.fulfill({ json: { session_id: "sess-1", phase: "idle", node_call_count: 0, ca3_ready: false, xml_ready: false } }),
  );

  // Agent SSE stream
  await page.route("**/v1/agent/sessions/sess-1/messages", route =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: [
        'data: {"content":"CA3 computed for January 2025."}',
        "data: [DONE]",
        "",
      ].join("\n"),
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Dashboard flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    // Bypass Clerk auth middleware by navigating directly
    await page.goto("/dashboard", { waitUntil: "networkidle" });
  });

  test("shows fiscal client cards on dashboard", async ({ page }) => {
    await expect(page.getByText("Acme SAS")).toBeVisible();
    await expect(page.getByText("Up to date")).toBeVisible();
  });

  test("navigates to client detail page", async ({ page }) => {
    await page.getByText("Acme SAS").click();
    await expect(page).toHaveURL(`/dashboard/clients/${CLIENT_ID}`);
    await expect(page.getByText("Imports")).toBeVisible();
    await expect(page.getByText("Declarations")).toBeVisible();
  });

  test("shows import in Imports tab", async ({ page }) => {
    await page.goto(`/dashboard/clients/${CLIENT_ID}`);
    await page.getByRole("button", { name: /Imports/i }).click();
    await expect(page.getByText("FEC_202501.txt")).toBeVisible();
    await expect(page.getByText("Uploaded")).toBeVisible();
  });

  test("classify button triggers classify API", async ({ page }) => {
    await page.goto(`/dashboard/clients/${CLIENT_ID}`);
    await page.getByRole("button", { name: /Imports/i }).click();

    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes(`/classify`)),
      page.getByTestId("classify-btn").click(),
    ]);
    expect(request.url()).toContain(`${IMPORT_ID}/classify`);
  });

  test("shows declaration in Declarations tab", async ({ page }) => {
    await page.goto(`/dashboard/clients/${CLIENT_ID}`);
    await page.getByRole("button", { name: /Declarations/i }).click();
    await expect(page.getByText("Jan 2025")).toBeVisible();
  });

  test("opens chat page with suggestions", async ({ page }) => {
    await page.goto(`/dashboard/clients/${CLIENT_ID}/chat`);
    await expect(page.getByText("Fiscal agent")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
  });

  test("sends chat message via suggestion chip", async ({ page }) => {
    await page.goto(`/dashboard/clients/${CLIENT_ID}/chat`);
    const chip = page.getByTestId("suggestion-chip").first();
    await chip.click();
    // Message should appear in thread
    await expect(page.getByText("Compute CA3 for last month")).toBeVisible();
  });

  test("declaration detail shows CA3 form fields", async ({ page }) => {
    await page.goto(`/dashboard/declarations/${DECL_ID}`);
    await expect(page.getByText("CA3 Declaration")).toBeVisible();
    await expect(page.getByText("Section A — Turnover")).toBeVisible();
    await expect(page.getByText("Section B — TVA Collected")).toBeVisible();
    await expect(page.getByText("Section D — Result")).toBeVisible();
  });

  test("validate button sends request", async ({ page }) => {
    await page.goto(`/dashboard/declarations/${DECL_ID}`);
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/validate")),
      page.getByTestId("validate-btn").click(),
    ]);
    expect(request.url()).toContain(`${DECL_ID}/validate`);
  });
});
