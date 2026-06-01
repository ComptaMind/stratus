/**
 * Pre-scripted SSE responses for demo mode.
 * Returns a fake Response whose body streams typed SSE events,
 * compatible with ChatClient's existing SSE parser.
 */

// ── Period detection ──────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, { num: string; name: string; days: number }> = {
  january: { num: "01", name: "January", days: 31 },
  jan:     { num: "01", name: "January", days: 31 },
  february:{ num: "02", name: "February", days: 28 },
  feb:     { num: "02", name: "February", days: 28 },
  march:   { num: "03", name: "March", days: 31 },
  mar:     { num: "03", name: "March", days: 31 },
  april:   { num: "04", name: "April", days: 30 },
  apr:     { num: "04", name: "April", days: 30 },
  may:     { num: "05", name: "May", days: 31 },
  june:    { num: "06", name: "June", days: 30 },
  jun:     { num: "06", name: "June", days: 30 },
  july:    { num: "07", name: "July", days: 31 },
  jul:     { num: "07", name: "July", days: 31 },
  august:  { num: "08", name: "August", days: 31 },
  aug:     { num: "08", name: "August", days: 31 },
  september:{ num: "09", name: "September", days: 30 },
  sep:     { num: "09", name: "September", days: 30 },
  october: { num: "10", name: "October", days: 31 },
  oct:     { num: "10", name: "October", days: 31 },
  november:{ num: "11", name: "November", days: 30 },
  nov:     { num: "11", name: "November", days: 30 },
  december:{ num: "12", name: "December", days: 31 },
  dec:     { num: "12", name: "December", days: 31 },
};

interface Period {
  name: string;
  start: string;
  end: string;
  isoStart: string;
  isoEnd: string;
}

function detectPeriod(message: string): Period {
  const lower = message.toLowerCase();
  const yearMatch = message.match(/20\d{2}/);
  const year = yearMatch ? yearMatch[0] : "2026";
  for (const [key, info] of Object.entries(MONTH_MAP)) {
    if (lower.includes(key)) {
      return {
        name: `${info.name} ${year}`,
        start: `01/${info.num}/${year}`,
        end:   `${String(info.days).padStart(2, "0")}/${info.num}/${year}`,
        isoStart: `${year}-${info.num}-01`,
        isoEnd:   `${year}-${info.num}-${String(info.days).padStart(2, "0")}`,
      };
    }
  }
  return { name: "January 2026", start: "01/01/2026", end: "31/01/2026", isoStart: "2026-01-01", isoEnd: "2026-01-31" };
}

// ── CA3 data ──────────────────────────────────────────────────────────────────

function buildCa3Lines(period: Period): Record<string, string> {
  const monthNum = parseInt(period.isoStart.slice(5, 7));
  const f = parseFloat((0.85 + (monthNum % 4) * 0.08).toFixed(2));
  const base   = Math.round(450000 * f);
  const tva20  = Math.round(base * 0.20);
  const intra  = Math.round(8500 * f);
  const autoliq= Math.round(4200 * f);
  const brute  = tva20 + intra + autoliq;
  const ded    = Math.round(45600 * f);
  const net    = brute - ded;
  return {
    L08: `${base}.00`, L16: `${tva20}.00`, L18: `${intra}.00`, L14: `${autoliq}.00`,
    L19: `${brute}.00`, L20: "0.00", L21: `${ded}.00`, L22: `${ded}.00`, L24: `${net}.00`,
  };
}

const CA3_WARNINGS = [
  { severity: "warning" as const, code: "LOW_CONFIDENCE", message: "Account 658100 (Misc. operating expenses) — confidence 61%. Please verify VAT deductibility." },
  { severity: "warning" as const, code: "LOW_CONFIDENCE", message: "Account 658200 (Penalties — ambiguous VAT) — confidence 58%. Confirm VAT treatment." },
];

const BOFIP_SOURCES = [
  { title: "BOI-TVA-BASE-10-10 — VAT base: general rules", url: "https://bofip.impots.gouv.fr/bofip/1063-PGP", score: 0.94 },
  { title: "BOI-TVA-DED-20-10 — Conditions for VAT deduction", url: "https://bofip.impots.gouv.fr/bofip/1456-PGP", score: 0.91 },
  { title: "BOI-TVA-DECLA-10-10 — CA3 return: filing rules", url: "https://bofip.impots.gouv.fr/bofip/2418-PGP", score: 0.87 },
];

const REASONING_SOURCES = [
  { title: "BOI-TVA-BASE-10-20 — Taxable transactions by nature", url: "https://bofip.impots.gouv.fr/bofip/1064-PGP", score: 0.96 },
  { title: "BOI-TVA-CHAMP-10-10 — Scope: taxable transactions", url: "https://bofip.impots.gouv.fr/bofip/893-PGP", score: 0.89 },
];

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sse(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function textDeltas(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 40) chunks.push(text.slice(i, i + 40));
  return chunks.map(c => sse({ type: "delta", content: c }));
}

// ── Scripts ───────────────────────────────────────────────────────────────────

function buildCa3Script(period: Period): string[] {
  const lines = buildCa3Lines(period);
  const net = parseFloat(lines.L24).toLocaleString("en-GB", { minimumFractionDigits: 2 });
  const intro =
    `I analyzed the FEC for **Cabinet Dupont & Associés** (${period.name}).\n\n` +
    `**5,000 entries** processed — **4,847** classified with confidence > 90%.\n` +
    `⚠️ **2 entries** flagged with low confidence (accounts 658100, 658200).\n\n` +
    `Here is the CA3 for **${period.start} – ${period.end}** (net VAT due: **€${net}**):`;
  return [
    ...textDeltas(intro),
    sse({ type: "ca3", lines }),
    sse({ type: "ca3_validation", validation: CA3_WARNINGS }),
    sse({ type: "sources", sources: BOFIP_SOURCES }),
    sse({ type: "state", phase: "ca3_ready", ca3_ready: true, xml_ready: false, node_call_count: 7 }),
    sse({ type: "done" }),
  ];
}

function buildReasoningScript(period: Period): string[] {
  const lines = buildCa3Lines(period);
  const l08 = parseFloat(lines.L08).toLocaleString("en-GB");
  const l16 = parseFloat(lines.L16).toLocaleString("en-GB");
  const text =
    `**Line 16 — Output VAT 20%** (L16 = €${l16})\n\n` +
    `This amount represents VAT collected on professional fees (accounts 706000, 706100) at 20%.\n\n` +
    `**Calculation:** Taxable base L08 (€${l08}) × 20% = **€${l16}**.\n\n` +
    `Under **BOI-TVA-BASE-10-20**, services rendered by an accounting firm are subject to VAT at 20% ` +
    `when provided for consideration by a taxable person acting as such (Art. 256 CGI). ` +
    `No exemption applies — Art. 261 CGI exemptions do not extend to non-medical professional services.`;
  return [...textDeltas(text), sse({ type: "sources", sources: REASONING_SOURCES }), sse({ type: "done" })];
}

function buildPositionScript(period: Period): string[] {
  const lines = buildCa3Lines(period);
  const net = parseFloat(lines.L24);
  const isCredit = net < 0;
  const abs = Math.abs(net).toLocaleString("en-GB", { minimumFractionDigits: 2 });
  const text =
    `**VAT position for ${period.name}:**\n\n` +
    (isCredit
      ? `The firm is in a **VAT credit position** of **€${abs}**.\n\nThis credit can be carried forward (line L23) or claimed as a refund if it exceeds €760 (Art. 242-0 A CGI).`
      : `The firm has a **net VAT liability of €${abs}** due for ${period.name}.\n\nThis amount (line L24) is payable to the French tax authority by the 19th of the following month.`);
  return [...textDeltas(text), sse({ type: "sources", sources: BOFIP_SOURCES.slice(0, 2) }), sse({ type: "done" })];
}

function buildGenericScript(period: Period): string[] {
  const text =
    `I'm your fiscal agent for **Cabinet Dupont & Associés**.\n\n` +
    `I can help you with:\n` +
    `- **Compute CA3** for any period (e.g. "Compute CA3 for ${period.name}")\n` +
    `- **VAT position** (e.g. "What is the VAT position for ${period.name}?")\n` +
    `- **Line reasoning** (e.g. "Show me your reasoning on line 16")\n` +
    `- **Anomaly detection** across classified FEC entries`;
  return [...textDeltas(text), sse({ type: "done" })];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function createDemoSSEResponse(
  message: string,
  _history: Array<{ role: "user" | "assistant"; content: string }> = [],
): Promise<Response> {
  const period = detectPeriod(message);
  const isCa3Query      = /\bca3\b|ca 3|comput|calculat|declare|return|vat return/i.test(message);
  const isReasoningQuery = /reasoning|explain|why|how|line\s*\d{1,2}/i.test(message);
  const isPositionQuery  = /position|balance|credit|debit|how much|amount due/i.test(message);

  let events: string[];
  if (isReasoningQuery)      events = buildReasoningScript(period);
  else if (isCa3Query)       events = buildCa3Script(period);
  else if (isPositionQuery)  events = buildPositionScript(period);
  else                       events = buildGenericScript(period);

  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (i >= events.length) { controller.close(); return; }
      await new Promise(r => setTimeout(r, 30));
      controller.enqueue(encoder.encode(events[i++]));
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
