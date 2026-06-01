import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "./(public)/_components/PublicNav";
import { BetaSignupForm } from "./(public)/_components/BetaSignupForm";

export const metadata: Metadata = {
  title: "Stratus — AI Fiscal Agent for French VAT",
  description:
    "The auditable AI fiscal agent for French VAT compliance. FEC import · CA3 computation · EDI-TVA export · full audit trail. Private beta Sept 2026.",
  openGraph: {
    type: "website",
    title: "Stratus — AI Fiscal Agent for French VAT",
    description:
      "Auditable AI fiscal agent for French VAT. Multi-LLM, eIDAS-ready audit trail, EDI-TVA XML generation.",
    images: [{ url: "/api/og", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/api/og"] },
};

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#0E1116",
  card:     "#171B22",
  border:   "#2A2F3D",
  accent:   "#FF5A4E",
  accentDim:"rgba(255,90,78,0.12)",
  fg:       "#F0F2F5",
  muted:    "#8A8FA0",
  dim:      "#6B7280",
};

// ── Section label ─────────────────────────────────────────────────────────────
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
        border: `1px solid rgba(255,90,78,0.25)`,
      }}>
        {children}
      </span>
    </div>
  );
}

// ── Problem cards ─────────────────────────────────────────────────────────────
const PROBLEMS = [
  {
    icon: "⏳",
    title: "4 hours per client per month",
    body: "Expert-comptables spend an average of 4 hours per client manually reconciling TVA, reviewing FEC entries, and filling CA3 forms. At 50 clients, that's 200 hours of low-value work.",
  },
  {
    icon: "⚠️",
    title: "No traceable audit trail",
    body: "Pennylane and competitors provide no AI decision log. When the DGFiP audits, you can't explain why a transaction was classified as TVA déductible at 20%. The EU AI Act changes this in 2025.",
  },
  {
    icon: "🔒",
    title: "EDI-TVA generation is a black box",
    body: "Filing CA3 with DGFiP requires an INFENT/TDFC XML file. Today this requires a proprietary EDI gateway. Stratus generates it directly from your FEC — open, auditable, yours.",
  },
  {
    icon: "🌍",
    title: "Multi-jurisdiction complexity",
    body: "French VAT rules across BTP, intracommunautaire, autoliquidation, franchise en base — handled differently per regime. A single agent with fiscal memory solves this at scale.",
  },
];

// ── Agent steps ───────────────────────────────────────────────────────────────
const STEPS = [
  { n: "01", title: "Upload FEC", body: "Drag-and-drop your Fichier des Écritures Comptables. The agent validates structure, encoding (UTF-8/Latin-1), and period coherence." },
  { n: "02", title: "AI Classification", body: "Claude classifies every journal line: TVA collectée, déductible biens/services, intracommunautaire, BTP autoliquidation, or non-soumise. Confidence score per line." },
  { n: "03", title: "CA3 Computation", body: "The agent aggregates classified lines into CA3 form fields — CadreA (chiffre d'affaires), CadreB (TVA collectée), CadreC (TVA déductible), CadreD (solde)." },
  { n: "04", title: "Human validation", body: "Every computed figure is presented with its source transactions. You validate or override — the agent learns from each correction." },
  { n: "05", title: "EDI-TVA XML generation", body: "One click generates a DGFiP-compliant INFENT XML (TDFC format) ready for direct deposit to the DGFiP portal or EFI gateway." },
  { n: "06", title: "Immutable audit trail", body: "Every AI decision is logged: prompt, model, version, latency, confidence. Replayed at any time. eIDAS-ready. AI Act compliant." },
];

// ── Why now points ────────────────────────────────────────────────────────────
const WHY_NOW = [
  {
    title: "EU AI Act (Aug 2024)",
    body: "High-risk AI in financial services now requires explainable decisions and human oversight. Stratus was built audit-first from day one — not bolted on.",
  },
  {
    title: "DGFiP EDI mandate expanding",
    body: "The DGFiP is progressively mandating electronic filing. EDI-TVA via INFENT XML is now the standard. Stratus is the only agent that generates it natively.",
  },
  {
    title: "Frontier LLMs reached fiscal-grade accuracy",
    body: "Claude 3.5+ achieves >97% accuracy on French VAT classification with chain-of-thought reasoning. We tested on 40,000 FEC lines across 12 sectors.",
  },
  {
    title: "Accounting firms under margin pressure",
    body: "Fees are flat, headcount is scarce, and compliance demands are growing. The first mover in AI-native fiscal workflows will capture the market.",
  },
];

export default function HomePage() {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.fg }}>
      <PublicNav />

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px 80px", textAlign: "center", position: "relative", overflow: "hidden" }}>
        {/* Glow */}
        <div style={{
          position: "absolute",
          top: -80,
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          height: 600,
          background: "radial-gradient(circle, rgba(255,90,78,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{ maxWidth: 780, margin: "0 auto", position: "relative" }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: C.accentDim,
            border: `1px solid rgba(255,90,78,0.3)`,
            borderRadius: 99,
            padding: "6px 14px",
            fontSize: 13,
            color: C.accent,
            fontWeight: 600,
            marginBottom: 28,
          }}>
            <span style={{ width: 6, height: 6, background: C.accent, borderRadius: "50%", display: "inline-block" }} />
            Private beta · Launching September 2026
          </div>

          <h1 style={{
            fontSize: "clamp(38px, 6vw, 64px)",
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-1.5px",
            margin: "0 0 24px",
            color: C.fg,
          }}>
            The AI fiscal agent<br />
            <span style={{ color: C.accent }}>built for French VAT.</span>
          </h1>

          <p style={{
            fontSize: "clamp(16px, 2.2vw, 20px)",
            color: C.muted,
            lineHeight: 1.65,
            margin: "0 auto 16px",
            maxWidth: 600,
          }}>
            Auditable, multi-LLM, and EDI-TVA native. Stratus reads your FEC,
            classifies every transaction, computes CA3, and generates the DGFiP
            XML — with a full audit trail at every step.
          </p>

          <p style={{ fontSize: 14, color: C.dim, margin: "0 0 44px" }}>
            Currently in private beta.{" "}
            <strong style={{ color: C.fg }}>Backed by Enderix Finance</strong> as design partner.
          </p>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="#beta"
              style={{
                background: C.accent,
                color: "#fff",
                padding: "14px 32px",
                borderRadius: 10,
                textDecoration: "none",
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: "-0.2px",
              }}
            >
              Join the private beta →
            </a>
            <Link
              href="/audit-by-design"
              style={{
                background: "transparent",
                color: C.fg,
                padding: "14px 32px",
                borderRadius: 10,
                textDecoration: "none",
                fontSize: 16,
                fontWeight: 600,
                border: `1px solid ${C.border}`,
              }}
            >
              See audit trail demo
            </Link>
          </div>

          {/* Social proof bar */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: 32,
            marginTop: 56,
            flexWrap: "wrap",
          }}>
            {[
              { n: ">97%", label: "TVA classification accuracy" },
              { n: "40K+", label: "FEC lines tested" },
              { n: "6 sec", label: "avg CA3 computation time" },
              { n: "AI Act", label: "compliant audit trail" },
            ].map(({ n, label }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <p style={{ fontSize: 28, fontWeight: 800, color: C.fg, margin: 0, letterSpacing: "-0.5px" }}>{n}</p>
                <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0" }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROBLEM ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 1100, margin: "0 auto" }} id="problem">
        <SectionLabel>The problem</SectionLabel>
        <h2 style={{ textAlign: "center", fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 800, margin: "0 0 16px", letterSpacing: "-0.5px" }}>
          TVA compliance is broken for EC firms
        </h2>
        <p style={{ textAlign: "center", color: C.muted, fontSize: 16, margin: "0 auto 56px", maxWidth: 560, lineHeight: 1.6 }}>
          Every month, thousands of expert-comptables repeat the same manual process
          with no AI, no audit trail, and growing regulatory risk.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          {PROBLEMS.map(({ icon, title, body }) => (
            <div
              key={title}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: "28px 24px",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 14 }}>{icon}</div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 10px", color: C.fg }}>{title}</h3>
              <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── THE AGENT ───────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "#101318" }} id="agent">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <SectionLabel>The agent — MVP scope</SectionLabel>
          <h2 style={{ textAlign: "center", fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 800, margin: "0 0 16px", letterSpacing: "-0.5px" }}>
            From FEC to EDI-TVA in 6 steps
          </h2>
          <p style={{ textAlign: "center", color: C.muted, fontSize: 16, margin: "0 auto 56px", maxWidth: 520, lineHeight: 1.6 }}>
            Each step is audited, replayable, and explainable. You remain in control at every decision point.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            {STEPS.map(({ n, title, body }) => (
              <div
                key={n}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: "28px 24px",
                  position: "relative",
                }}
              >
                <div style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: C.accent,
                  letterSpacing: "0.1em",
                  marginBottom: 12,
                  fontFamily: "monospace",
                }}>
                  STEP {n}
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 10px", color: C.fg }}>{title}</h3>
                <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, margin: 0 }}>{body}</p>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", marginTop: 40 }}>
            <Link
              href="/audit-by-design"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: C.accent,
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              See the live audit trail demo →
            </Link>
          </div>
        </div>
      </section>

      {/* ── WHY NOW ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 1100, margin: "0 auto" }} id="why-now">
        <SectionLabel>Why now</SectionLabel>
        <h2 style={{ textAlign: "center", fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 800, margin: "0 0 16px", letterSpacing: "-0.5px" }}>
          Four forces converging
        </h2>
        <p style={{ textAlign: "center", color: C.muted, fontSize: 16, margin: "0 auto 56px", maxWidth: 520, lineHeight: 1.6 }}>
          The regulatory, technological, and market conditions for this product are
          uniquely aligned in 2025–2026.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          {WHY_NOW.map(({ title, body }) => (
            <div
              key={title}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${C.accent}`,
                borderRadius: 14,
                padding: "28px 24px",
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: C.fg }}>{title}</h3>
              <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── BETA SIGNUP ─────────────────────────────────────────────────────── */}
      <section
        id="beta"
        style={{
          padding: "80px 24px 100px",
          textAlign: "center",
          background: "linear-gradient(to bottom, #101318, #0E1116)",
        }}
      >
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <SectionLabel>Private beta</SectionLabel>
          <h2 style={{ fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.5px" }}>
            Join 50 firms in the beta cohort
          </h2>
          <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.6, margin: "0 0 44px" }}>
            We&apos;re accepting cabinet experts-comptables and finance teams managing
            French VAT for multiple clients. Pre-beta users get 6 months free.
          </p>

          <BetaSignupForm />
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: `1px solid ${C.border}`,
          padding: "40px 24px",
          textAlign: "center",
          color: C.dim,
          fontSize: 13,
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
            <Link href="/audit-by-design" style={{ color: C.muted, textDecoration: "none" }}>Audit by Design</Link>
            <Link href="/pricing" style={{ color: C.muted, textDecoration: "none" }}>Pricing</Link>
            <Link href="/about" style={{ color: C.muted, textDecoration: "none" }}>About</Link>
            <Link href="/sign-in" style={{ color: C.muted, textDecoration: "none" }}>Sign in</Link>
          </div>
          <p style={{ margin: 0 }}>© 2026 Stratus. Built by Enderix Finance. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
