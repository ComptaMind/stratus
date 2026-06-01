import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Built by Anne-Carla Kamgang, founder of Enderix Finance. Stratus was born from the pain of managing multi-jurisdiction VAT compliance at scale.",
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
        background: C.accentDim, color: C.accent, fontSize: 12, fontWeight: 700,
        letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 14px",
        borderRadius: 99, border: "1px solid rgba(255,90,78,0.25)",
      }}>
        {children}
      </span>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section style={{ padding: "80px 24px 60px", textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
        <SectionLabel>About</SectionLabel>
        <h1 style={{ fontSize: "clamp(30px, 5vw, 50px)", fontWeight: 800, margin: "0 0 20px", letterSpacing: "-1px", lineHeight: 1.1 }}>
          Built from the inside<br />
          <span style={{ color: C.accent }}>by someone who hit the wall.</span>
        </h1>
      </section>

      {/* Founder */}
      <section style={{ padding: "0 24px 80px", maxWidth: 800, margin: "0 auto" }}>
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 20,
          padding: "40px 48px",
          display: "flex",
          gap: 40,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}>
          {/* Avatar placeholder */}
          <div style={{
            width: 100,
            height: 100,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${C.accent} 0%, #FF8C7A 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
            flexShrink: 0,
          }}>
            👩🏾‍💻
          </div>

          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: C.fg }}>
              Anne-Carla Kamgang
            </h2>
            <p style={{ fontSize: 14, color: C.accent, fontWeight: 600, margin: "0 0 20px" }}>
              Founder &amp; CEO · Stratus
            </p>
            <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
              {["Enderix Finance", "FinTech builder", "Paris · London"].map(tag => (
                <span
                  key={tag}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${C.border}`,
                    borderRadius: 99,
                    padding: "4px 12px",
                    fontSize: 12,
                    color: C.muted,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
            <div style={{ display: "grid", gap: 16, fontSize: 15, lineHeight: 1.75, color: C.muted }}>
              <p style={{ margin: 0 }}>
                I built <strong style={{ color: C.fg }}>Enderix Finance</strong> to help finance teams manage multi-entity,
                multi-jurisdiction reporting. It worked — until TVA compliance across France, Belgium, and Luxembourg
                became a bottleneck that no existing tool could solve without weeks of manual work per quarter.
              </p>
              <p style={{ margin: 0 }}>
                Every expert-comptable I talked to described the same pain: hours spent on CA3 forms,
                no audit trail for DGFiP inspections, and EDI-TVA generation locked behind proprietary gateways.
                The tools were designed for the 1990s filing workflow.
              </p>
              <p style={{ margin: 0 }}>
                So I decided to build the agent I wished existed. Stratus is my answer to that wall —
                an AI fiscal agent that is <strong style={{ color: C.fg }}>auditable by design</strong>,
                generates EDI-TVA XML natively, and puts the accountant back in control of every decision.
              </p>
              <p style={{ margin: 0 }}>
                If you&apos;re an expert-comptable or a finance team managing French VAT for multiple entities,
                I want to hear your workflow. <a href="mailto:ac@stratus.finance" style={{ color: C.accent }}>Write to me directly</a>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section style={{ padding: "60px 24px 80px", background: "#101318" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          <SectionLabel>Timeline</SectionLabel>
          <h2 style={{ textAlign: "center", fontSize: 28, fontWeight: 800, margin: "0 0 48px", letterSpacing: "-0.5px" }}>
            How we got here
          </h2>
          <div style={{ position: "relative", paddingLeft: 28 }}>
            {/* Line */}
            <div style={{
              position: "absolute",
              left: 7,
              top: 8,
              bottom: 8,
              width: 2,
              background: `linear-gradient(to bottom, ${C.accent}, transparent)`,
            }} />

            {[
              { date: "2021", title: "Enderix Finance founded", body: "Built financial reporting SaaS for multi-entity SMEs across France, Belgium, and Luxembourg." },
              { date: "2023", title: "Hit the multi-jurisdiction TVA wall", body: "At 40+ clients, manual CA3 reconciliation became unsustainable. Existing tools had no AI, no audit trail, no EDI generation." },
              { date: "Jan 2025", title: "Stratus prototype", body: "First FEC parser + Claude classification pipeline. 94% accuracy on first 10,000 lines from Enderix clients. The thesis was validated." },
              { date: "Jun 2025", title: "Private beta launched", body: "Enderix Finance becomes first design partner. Full audit trail, CA3 computation, EDI-TVA XML generation working end-to-end." },
              { date: "Sept 2026", title: "Public MVP launch", body: "50 cabinet beta cohort → public launch. Cabinet plan, API access, multi-LLM support." },
            ].map(({ date, title, body }) => (
              <div key={date} style={{ position: "relative", paddingBottom: 32, display: "flex", gap: 20 }}>
                {/* Dot */}
                <div style={{
                  position: "absolute",
                  left: -28,
                  top: 4,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: C.accent,
                  border: `2px solid ${C.bg}`,
                  flexShrink: 0,
                }} />
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, fontFamily: "monospace" }}>{date}</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: "4px 0 6px", color: C.fg }}>{title}</h3>
                  <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.65 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }}>
        <SectionLabel>Principles</SectionLabel>
        <h2 style={{ textAlign: "center", fontSize: 28, fontWeight: 800, margin: "0 0 48px", letterSpacing: "-0.5px" }}>
          What we believe
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          {[
            { icon: "🔍", t: "Auditability is not optional", b: "Any AI making financial decisions must be fully explainable. We built the audit trail first, the feature second." },
            { icon: "🧑‍💼", t: "The accountant stays in control", b: "AI classifies. The human validates. No automated filing without explicit sign-off. This is non-negotiable." },
            { icon: "🇫🇷", t: "French fiscal law, deeply", b: "PCG, SYSCOHADA, DGFiP formats, régimes de TVA — we know the domain. We are not a generic AI wrapper." },
            { icon: "🌐", t: "Open by default", b: "EDI-TVA XML is yours. Audit bundles are downloadable ZIPs. No lock-in. You can leave with your data at any time." },
          ].map(({ icon, t, b }) => (
            <div key={t} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "28px 24px" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: C.fg }}>{t}</h3>
              <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.65, margin: 0 }}>{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact + CTA */}
      <section style={{ textAlign: "center", padding: "20px 24px 80px" }}>
        <div style={{ maxWidth: 500, margin: "0 auto" }}>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 12px" }}>Get in touch</h2>
          <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.6, margin: "0 0 28px" }}>
            Design partners, press, investors — write directly to{" "}
            <a href="mailto:ac@stratus.finance" style={{ color: C.accent }}>ac@stratus.finance</a>
          </p>
          <a href="/#beta" style={{
            background: C.accent, color: "#fff", padding: "14px 32px",
            borderRadius: 10, textDecoration: "none", fontSize: 16, fontWeight: 700,
          }}>
            Join the private beta →
          </a>
        </div>
      </section>
    </div>
  );
}
