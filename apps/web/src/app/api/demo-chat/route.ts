import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEMO_CONTEXT = `You are Stratus, an AI fiscal agent specialized in French VAT (TVA) accounting.
You are analyzing the FEC (Fichier des Écritures Comptables) for:
- Client: Cabinet Dupont & Associés (SIRET: 41234567800012)
- Period loaded: January 2026 (5,000 entries)

FEC classification results for January 2026:
- 4,847 entries classified with confidence > 90%
- 2 entries flagged with LOW confidence:
  • Account 658100 (Misc. operating expenses) — 61% confidence, ambiguous VAT treatment
  • Account 658200 (Penalties/fines) — 58% confidence, VAT deductibility unclear
- Total taxable revenue (706xxx): €450,000
- Output VAT 20%: €90,000 | Intra-EU acquisitions TVA: €8,500 | Reverse-charge BTP: €4,200
- Total output VAT (L19): €102,700
- Deductible VAT (44566): €45,600
- Net VAT due (L24): €57,100

CA3 computed for 01/01/2026–31/01/2026:
L08=450000 L16=90000 L18=8500 L14=4200 L19=102700 L20=0 L21=45600 L22=45600 L24=57100

Instructions:
- Always answer in English
- Be precise and concise
- Cite CGI articles and BOFiP references when relevant (BOI-TVA-BASE-10-10, BOI-TVA-DED-20-10, etc.)
- For CA3 / declare / compute queries: present the key amounts and mention the table will appear below
- For reasoning / line explanation queries: walk through the calculation with legal basis
- For questions about other periods: explain only Jan 2026 is loaded but you can process any period once the FEC is uploaded
- For general questions: answer helpfully about French TVA rules`;

const CA3_LINES: Record<string, string> = {
  L08: "450000.00", L16: "90000.00", L18: "8500.00", L14: "4200.00",
  L19: "102700.00", L20: "0.00", L21: "45600.00", L22: "45600.00", L24: "57100.00",
};

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
  { title: "BOI-TVA-DED-30-10 — Pro-rata and partial deduction", url: "https://bofip.impots.gouv.fr/bofip/1502-PGP", score: 0.83 },
];

function sse(obj: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function isCa3Query(msg: string) {
  return /\bca3\b|ca 3|comput|calculat|declar|vat return|generate.*ca3|show.*ca3/i.test(msg);
}

function isReasoningQuery(msg: string) {
  return /reasoning|explain|why|how.*work|line\s*\d{1,2}|l0\d|l1\d|l2\d/i.test(msg);
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      `data: ${JSON.stringify({ type: "delta", content: "⚠️ ANTHROPIC_API_KEY not set. Add it to apps/web/.env.local to enable the real AI agent." })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const { message, history = [] } = (await req.json()) as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messages: Anthropic.MessageParam[] = [
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: message },
        ];

        const claudeStream = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: DEMO_CONTEXT,
          messages,
        });

        for await (const event of claudeStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(sse({ type: "delta", content: event.delta.text }));
          }
        }

        // Emit structured events based on intent
        const ca3 = isCa3Query(message);
        const reasoning = isReasoningQuery(message);

        if (ca3 && !reasoning) {
          controller.enqueue(sse({ type: "ca3", lines: CA3_LINES }));
          controller.enqueue(sse({ type: "ca3_validation", validation: CA3_WARNINGS }));
          controller.enqueue(sse({ type: "state", phase: "ca3_ready", ca3_ready: true, xml_ready: false, node_call_count: 7 }));
        }

        if (ca3 || reasoning) {
          controller.enqueue(sse({ type: "sources", sources: reasoning ? REASONING_SOURCES : BOFIP_SOURCES }));
        }

        controller.enqueue(sse({ type: "done" }));
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(sse({ type: "delta", content: `\n\n⚠️ Agent error: ${msg}` }));
        controller.enqueue(sse({ type: "done" }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
