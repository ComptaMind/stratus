import type { Metadata } from "next";
import { ReplayDemo } from "./_components/ReplayDemo";

export const metadata: Metadata = {
  title: "Audit by Design",
  description:
    "Stratus logs every AI decision — prompt, model, version, confidence, latency — and lets you replay them at any time. eIDAS-ready. EU AI Act compliant.",
  openGraph: { images: [{ url: "/api/og?page=audit", width: 1200, height: 630 }] },
};

const C = {
  bg: "#0E1116", card: "#171B22", border: "#2A2F3D",
  accent: "#FF5A4E", accentDim: "rgba(255,90,78,0.10)",
  fg: "#F0F2F5", muted: "#8A8FA0",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
      <span style={{
        background: C.accentDim,
        color: C.accent,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "4px 14px",
        borderRadius: 99,
        border: "1px solid rgba(255,90,78,0.25)",
      }}>
        {children}
      </span>
    </div>
  );
}

const PILLARS = [
  {
    icon: "🔍",
    title: "Every decision logged",
    body: "Each AI classification call logs the exact prompt sent, the model name and version, response, confidence score, latency, and RAG sources (BOFiP chunks retrieved). Nothing is a black box.",
  },
  {
    icon: "↺",
    title: "Replay at any time",
    body: "Re-run any historical decision against today's model. Side-by-side diff shows if the answer changed — and the audit log records both responses with full metadata.",
  },
  {
    icon: "🇪🇺",
    title: "EU AI Act ready",
    body: "Article 13 (transparency) and Article 14 (human oversight) are built into the workflow. Every auto-classified transaction requires human validation before it counts.",
  },
  {
    icon: "🔐",
    title: "eIDAS-grade immutability",
    body: "Audit events are append-only at the database level (UPDATE/DELETE blocked by trigger). SHA-256 chain hash links each event to the previous, making tampering detectable.",
  },
  {
    icon: "🤖",
    title: "Multi-LLM by design",
    body: "Switch between Claude, GPT-4o, Mistral, or Gemini per classification task. The audit trail captures which model made which decision — enabling cost/accuracy optimization.",
  },
  {
    icon: "📦",
    title: "Export replay bundle",
    body: "Download a ZIP containing the full JSONL audit log, all prompts as .txt, all BOFiP chunks as .html, and the generated CA3 XML — for any external audit.",
  },
];

export default function AuditByDesignPage() {
  return (
    <div>
      {/* Hero */}
      <section style={{ padding: "80px 24px 60px", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <SectionLabel>Key differentiator</SectionLabel>
        <h1 style={{
          fontSize: "clamp(32px, 5vw, 54px)",
          fontWeight: 800,
          letterSpacing: "-1px",
          margin: "0 0 20px",
          lineHeight: 1.1,
        }}>
          Audit by Design —<br />
          <span style={{ color: C.accent }}>not an afterthought</span>
        </h1>
        <p style={{ fontSize: 18, color: C.muted, lineHeight: 1.65, margin: "0 auto 40px", maxWidth: 580 }}>
          Pennylane and Black Ore classify transactions. Only Stratus lets you
          replay every AI decision, compare models, and export the full audit bundle
          for DGFiP or external review.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap" }}>
          {[
            { n: "100%", l: "of AI decisions logged" },
            { n: "Zero", l: "black box operations" },
            { n: "SHA-256", l: "event chain integrity" },
          ].map(({ n, l }) => (
            <div key={l} style={{ textAlign: "center" }}>
              <p style={{ fontSize: 28, fontWeight: 800, color: C.accent, margin: 0 }}>{n}</p>
              <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0" }}>{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live demo */}
      <section style={{ padding: "20px 24px 80px", maxWidth: 900, margin: "0 auto" }}>
        <SectionLabel>Live demo — fake data, real UI</SectionLabel>
        <h2 style={{ textAlign: "center", fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, margin: "0 0 12px", letterSpacing: "-0.5px" }}>
          Replay this classification decision
        </h2>
        <p style={{ textAlign: "center", color: C.muted, fontSize: 15, margin: "0 0 36px", lineHeight: 1.6 }}>
          This is a real audit event from our test suite — same prompt, same JSON structure, same UI
          as the live product. Click <strong style={{ color: C.fg }}>&ldquo;Replay with current model&rdquo;</strong> to see
          what today&apos;s Claude would say.
        </p>
        <ReplayDemo />
      </section>

      {/* 6 pillars */}
      <section style={{ padding: "60px 24px 80px", background: "#101318" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <SectionLabel>Architecture</SectionLabel>
          <h2 style={{ textAlign: "center", fontSize: "clamp(22px, 3vw, 36px)", fontWeight: 800, margin: "0 0 48px", letterSpacing: "-0.5px" }}>
            Six pillars of auditability
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            {PILLARS.map(({ icon, title, body }) => (
              <div
                key={title}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: "28px 24px",
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: C.fg }}>{title}</h3>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance timeline */}
      <section style={{ padding: "80px 24px", maxWidth: 800, margin: "0 auto" }}>
        <SectionLabel>Regulatory context</SectionLabel>
        <h2 style={{ textAlign: "center", fontSize: "clamp(22px, 3vw, 36px)", fontWeight: 800, margin: "0 0 48px", letterSpacing: "-0.5px" }}>
          The compliance case for auditability
        </h2>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            { date: "Aug 2024", event: "EU AI Act enters into force", detail: "High-risk AI in financial services requires Article 13 transparency and Article 14 human oversight. Logging is no longer optional." },
            { date: "Feb 2025", event: "EU AI Act high-risk provisions apply", detail: "Systems making decisions that affect a person's access to financial services are explicitly classified as high-risk. VAT compliance AI qualifies." },
            { date: "2025–2026", event: "DGFiP EDI mandate expansion", detail: "Progressive rollout of mandatory electronic filing. INFENT XML format becomes standard for CA3 submission. Manual EDI gateways are phased out." },
            { date: "Sept 2026", event: "Stratus MVP launch", detail: "Full audit trail, eIDAS-ready event chain, EDI-TVA XML generation. First AI fiscal agent designed to be compliant from day one." },
          ].map(({ date, event, detail }) => (
            <div
              key={date}
              style={{
                display: "flex",
                gap: 20,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "20px 24px",
              }}
            >
              <div style={{ minWidth: 80 }}>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: C.accent,
                  fontFamily: "monospace",
                }}>{date}</span>
              </div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6px", color: C.fg }}>{event}</p>
                <p style={{ fontSize: 13, color: C.muted, margin: 0, lineHeight: 1.6 }}>{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ textAlign: "center", padding: "40px 24px 80px" }}>
        <h2 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 16px" }}>
          See it in action with your own FEC
        </h2>
        <p style={{ color: C.muted, fontSize: 16, margin: "0 0 28px" }}>
          Join the private beta and get full access before September 2026.
        </p>
        <a
          href="/#beta"
          style={{
            background: C.accent,
            color: "#fff",
            padding: "14px 32px",
            borderRadius: 10,
            textDecoration: "none",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          Join the private beta →
        </a>
      </section>
    </div>
  );
}
