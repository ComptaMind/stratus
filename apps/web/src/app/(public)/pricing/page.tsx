import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Stratus pricing — Indé €39/mo, Pro €149/mo, Cabinet €790/mo, Enterprise custom. Pre-beta users get 6 months free.",
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

const PLANS = [
  {
    id: "inde",
    name: "Indé",
    price: "€39",
    period: "/ month",
    desc: "For independent accountants and sole practitioners managing a small portfolio.",
    highlight: false,
    cta: "Join beta",
    features: [
      "Up to 5 fiscal clients",
      "FEC import & AI classification",
      "CA3 computation (monthly)",
      "EDI-TVA XML generation",
      "Audit trail (30 days)",
      "Email support",
    ],
    missing: [
      "Quarterly declarations",
      "Multi-user access",
      "Replay bundle export",
      "API access",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "€149",
    period: "/ month",
    desc: "For growing practices and finance teams managing up to 30 clients.",
    highlight: true,
    cta: "Join beta — most popular",
    features: [
      "Up to 30 fiscal clients",
      "FEC import & AI classification",
      "CA3 monthly + quarterly",
      "EDI-TVA XML generation",
      "Audit trail (unlimited)",
      "Replay bundle export",
      "Multi-user (3 seats)",
      "Priority email support",
    ],
    missing: [
      "White-label",
      "API access",
      "Dedicated onboarding",
    ],
  },
  {
    id: "cabinet",
    name: "Cabinet",
    price: "€790",
    period: "/ month",
    desc: "For established EC firms managing 100+ clients with multi-user workflows.",
    highlight: false,
    cta: "Join beta",
    features: [
      "Unlimited fiscal clients",
      "FEC import & AI classification",
      "CA3 monthly + quarterly",
      "EDI-TVA XML generation",
      "Audit trail (unlimited)",
      "Replay bundle export",
      "Unlimited seats",
      "API access",
      "White-label option",
      "Dedicated onboarding",
      "SLA 99.9%",
    ],
    missing: [],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "For large groups, banks, and software publishers embedding Stratus.",
    highlight: false,
    cta: "Contact us",
    features: [
      "Everything in Cabinet",
      "On-premise / private cloud option",
      "Custom LLM provider (bring your own)",
      "eIDAS advanced signature",
      "SOC 2 Type II (2027)",
      "Dedicated support & SLA",
      "Volume licensing",
    ],
    missing: [],
  },
];

function Check() {
  return <span style={{ color: "#34d399", marginRight: 8 }}>✓</span>;
}
function Cross() {
  return <span style={{ color: "#4B5563", marginRight: 8 }}>✗</span>;
}

export default function PricingPage() {
  return (
    <div>
      <section style={{ padding: "80px 24px 60px", textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
        <SectionLabel>Pricing</SectionLabel>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 52px)", fontWeight: 800, margin: "0 0 16px", letterSpacing: "-1px" }}>
          Simple, transparent pricing
        </h1>
        <p style={{ fontSize: 18, color: C.muted, lineHeight: 1.65, margin: "0 0 24px" }}>
          Designed for expert-comptables who want to move fast.
        </p>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(255,90,78,0.08)",
          border: "1px solid rgba(255,90,78,0.3)",
          borderRadius: 10,
          padding: "12px 20px",
          fontSize: 14,
        }}>
          <span style={{ fontSize: 20 }}>🎁</span>
          <p style={{ margin: 0, color: C.fg, lineHeight: 1.5 }}>
            <strong>Pricing locked at MVP launch.</strong>{" "}
            Pre-beta users get <strong style={{ color: C.accent }}>6 months free</strong> at their plan tier — no credit card required.
          </p>
        </div>
      </section>

      <section style={{ padding: "0 24px 80px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, alignItems: "start" }}>
          {PLANS.map(plan => (
            <div
              key={plan.id}
              style={{
                background: plan.highlight ? "rgba(255,90,78,0.06)" : C.card,
                border: plan.highlight ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                borderRadius: 16,
                padding: "32px 28px",
                position: "relative",
              }}
            >
              {plan.highlight && (
                <div style={{
                  position: "absolute",
                  top: -14,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: C.accent,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "4px 16px",
                  borderRadius: 99,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}>
                  Most popular
                </div>
              )}

              <p style={{ fontSize: 13, fontWeight: 700, color: plan.highlight ? C.accent : C.muted, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {plan.name}
              </p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 40, fontWeight: 800, color: C.fg, letterSpacing: "-1px" }}>{plan.price}</span>
                {plan.period && <span style={{ fontSize: 15, color: C.muted }}>{plan.period}</span>}
              </div>
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: "0 0 24px" }}>{plan.desc}</p>

              <a
                href="/#beta"
                style={{
                  display: "block",
                  textAlign: "center",
                  background: plan.highlight ? C.accent : "transparent",
                  color: plan.highlight ? "#fff" : C.fg,
                  border: plan.highlight ? "none" : `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "11px 16px",
                  fontSize: 14,
                  fontWeight: 700,
                  textDecoration: "none",
                  marginBottom: 24,
                }}
              >
                {plan.cta}
              </a>

              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 20 }}>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ fontSize: 13, color: C.fg, display: "flex", alignItems: "flex-start" }}>
                      <Check />{f}
                    </li>
                  ))}
                  {plan.missing.map(f => (
                    <li key={f} style={{ fontSize: 13, color: "#4B5563", display: "flex", alignItems: "flex-start" }}>
                      <Cross />{f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "60px 24px 80px", maxWidth: 720, margin: "0 auto" }}>
        <h2 style={{ fontSize: 28, fontWeight: 800, textAlign: "center", margin: "0 0 40px", letterSpacing: "-0.5px" }}>
          Frequently asked questions
        </h2>
        <div style={{ display: "grid", gap: 16 }}>
          {[
            {
              q: "When does billing start?",
              a: "Billing starts at MVP launch in September 2026. Pre-beta users get 6 months free from their launch date.",
            },
            {
              q: "Can I switch plans?",
              a: "Yes. Plans are month-to-month after the free period. Upgrade or downgrade at any time with prorated billing.",
            },
            {
              q: "Is my FEC data secure?",
              a: "FEC files are stored encrypted on Scaleway Object Storage (EU region, ISO 27001). We never train our models on your data.",
            },
            {
              q: "Do you support quarterly TVA declarations?",
              a: "CA3 quarterly (Pro+) is on the September 2026 roadmap. Régime simplifié (CA12) is planned for Q1 2027.",
            },
            {
              q: "Can I use my own LLM provider?",
              a: "Enterprise plan supports custom LLM providers (OpenAI, Azure OpenAI, local Mistral). Contact us for details.",
            },
          ].map(({ q, a }) => (
            <div
              key={q}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: "20px 24px",
              }}
            >
              <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px", color: C.fg }}>{q}</p>
              <p style={{ fontSize: 14, color: C.muted, margin: 0, lineHeight: 1.65 }}>{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ textAlign: "center", padding: "20px 24px 80px" }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 12px" }}>Lock in your beta spot</h2>
        <p style={{ color: C.muted, margin: "0 0 24px", fontSize: 15 }}>50 firms max. Pre-beta pricing guaranteed.</p>
        <a href="/#beta" style={{
          background: C.accent, color: "#fff", padding: "14px 32px",
          borderRadius: 10, textDecoration: "none", fontSize: 16, fontWeight: 700,
        }}>
          Join the private beta →
        </a>
      </section>
    </div>
  );
}
