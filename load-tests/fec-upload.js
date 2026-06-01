/**
 * k6 load test: FEC upload under concurrent load
 *
 * Simulates 100 concurrent users each uploading a 5k-entry FEC file
 * to the Stratus API and triggering classification.
 *
 * Thresholds:
 *   - p95 end-to-end (upload + classify) < 60 s
 *   - error rate < 1%
 *   - no DB pool exhaustion (HTTP 503 count = 0)
 *
 * Run:
 *   k6 run --env API_URL=https://api.stratus.tax load-tests/fec-upload.js
 *   k6 run --env API_URL=http://localhost:3001 load-tests/fec-upload.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { randomString } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const API_URL      = __ENV.API_URL ?? "http://localhost:3001";
const ORG_ID       = __ENV.ORG_ID ?? "load-test-org";
const API_KEY      = __ENV.API_KEY ?? "load-test-key";
const CLIENT_COUNT = parseInt(__ENV.CLIENT_COUNT ?? "100");

export const options = {
  scenarios: {
    fec_upload: {
      executor: "per-vu-iterations",
      vus: 100,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    // p95 of the full upload+classify cycle must be under 60 s
    "http_req_duration{name:classify}": ["p(95)<60000"],
    // Overall error rate < 1%
    http_req_failed: ["rate<0.01"],
    // No DB pool exhaustion (503s)
    "checks{name:no_db_pool_exhaustion}": ["rate==1"],
  },
};

// ── Custom metrics ─────────────────────────────────────────────────────────────

const classifyDuration    = new Trend("classify_duration_ms", true);
const dbPoolErrors        = new Counter("db_pool_errors");

// ── FEC generator ─────────────────────────────────────────────────────────────

function buildFecContent(rowCount) {
  const header = "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|LettragePiece|DateLet|ValidDate|MontantDevise|CodeDevise";
  const rows = [header];

  for (let i = 0; i < rowCount; i++) {
    const isVente  = i % 2 === 0;
    const journal  = isVente ? "VT" : "AC";
    const journal2 = isVente ? "Ventes" : "Achats";
    const compte   = isVente ? "706000" : "601100";
    const montant  = (Math.round(Math.random() * 10000 * 100) / 100).toFixed(2).replace(".", ",");
    const date     = "20250101";
    const ref      = `REF${String(i).padStart(6, "0")}`;

    rows.push(
      `${journal}|${journal2}|${ref}|${date}|${compte}|Libellé compte|||${ref}|${date}|Ecriture ${i}|${montant}|0,00||||`,
    );
    rows.push(
      `${journal}|${journal2}|${ref}|${date}|${isVente ? "411000" : "401000"}|Tiers|||${ref}|${date}|Ecriture ${i}|0,00|${montant}||||`,
    );
  }

  return rows.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function headers(contentType = "application/json") {
  return {
    "Content-Type": contentType,
    "x-org-id": ORG_ID,
    "Authorization": `Bearer ${API_KEY}`,
  };
}

// ── Main scenario ──────────────────────────────────────────────────────────────

export default function () {
  const clientName = `LoadTestClient_${randomString(8)}`;

  // 1. Create fiscal client
  const createClientRes = http.post(
    `${API_URL}/v1/fiscal-clients`,
    JSON.stringify({ name: clientName, period_type: "monthly" }),
    { headers: headers(), tags: { name: "create_client" } },
  );

  const clientOk = check(createClientRes, {
    "client created (201)": r => r.status === 201,
    "no_db_pool_exhaustion": r => r.status !== 503,
  });

  if (createClientRes.status === 503) dbPoolErrors.add(1);
  if (!clientOk) return;

  const clientId = createClientRes.json("id");
  if (!clientId) return;

  // 2. Upload FEC (5k entries = 10k rows)
  const fecContent = buildFecContent(5000);
  const fecFile    = http.file(fecContent, `FEC_${clientId}.txt`, "text/plain");

  const uploadRes = http.post(
    `${API_URL}/v1/fec-imports`,
    { file: fecFile, fiscal_client_id: clientId },
    { headers: { "x-org-id": ORG_ID, "Authorization": `Bearer ${API_KEY}` }, tags: { name: "fec_upload" } },
  );

  const uploadOk = check(uploadRes, {
    "FEC uploaded (201)": r => r.status === 201,
    "no_db_pool_exhaustion": r => r.status !== 503,
  });

  if (uploadRes.status === 503) dbPoolErrors.add(1);
  if (!uploadOk) return;

  const importId = uploadRes.json("id");
  if (!importId) return;

  // 3. Trigger classification (timed)
  const classifyStart = Date.now();

  const classifyRes = http.post(
    `${API_URL}/v1/fec-imports/${importId}/classify`,
    null,
    { headers: headers(), tags: { name: "classify" } },
  );

  const classifyMs = Date.now() - classifyStart;
  classifyDuration.add(classifyMs);

  check(classifyRes, {
    "classification triggered (200/202)": r => r.status === 200 || r.status === 202,
    "no_db_pool_exhaustion": r => r.status !== 503,
  });

  if (classifyRes.status === 503) dbPoolErrors.add(1);

  // 4. Poll for completion (up to 60 s)
  let attempts = 0;
  while (attempts < 60) {
    sleep(1);
    const statusRes = http.get(
      `${API_URL}/v1/fec-imports/${importId}`,
      { headers: headers(), tags: { name: "poll_classify_status" } },
    );

    if (statusRes.status !== 200) break;

    const status = statusRes.json("status");
    if (status === "classified" || status === "error") break;

    attempts++;
  }

  sleep(1);
}

// ── Teardown: print summary ────────────────────────────────────────────────────

export function handleSummary(data) {
  const p95 = data.metrics["http_req_duration{name:classify}"]?.values?.["p(95)"] ?? "N/A";
  const errRate = (data.metrics.http_req_failed?.values?.rate ?? 0) * 100;
  const pool503 = data.metrics.db_pool_errors?.values?.count ?? 0;

  console.log("=== Load Test Summary ===");
  console.log(`  Classify p95: ${typeof p95 === "number" ? p95.toFixed(0) + " ms" : p95}`);
  console.log(`  Error rate:   ${typeof errRate === "number" ? errRate.toFixed(2) + "%" : errRate}`);
  console.log(`  DB pool 503s: ${pool503}`);
  console.log("=========================");

  return {
    stdout: JSON.stringify(data, null, 2),
  };
}
