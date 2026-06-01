"use client";

import { useState } from "react";

const C = {
  bg: "#0E1116", card: "#171B22", border: "#2A2F3D",
  accent: "#FF5A4E", fg: "#F0F2F5", muted: "#8A8FA0",
};

const ORIGINAL_EVENT = {
  action: "entry.classified",
  timestamp: "2025-01-15T09:34:12Z",
  actor: "claude-sonnet-4-6",
  payload: {
    fec_entry: {
      JournalCode: "AC",
      EcritureDate: "2025-01-10",
      CompteNum: "60110000",
      EcritureLib: "FACTURE FOURNISSEUR SARL DUPONT MATÉRIAUX",
      Debit: "12000.00",
      Credit: "0.00",
    },
    prompt: `You are a French VAT classification expert. Classify this FEC journal entry.

Entry:
- Journal: AC (Achats)
- Date: 2025-01-10
- Account: 60110000 (Matières premières)
- Label: FACTURE FOURNISSEUR SARL DUPONT MATÉRIAUX
- Debit: 12,000.00 €

Possible classifications:
- tva_deductible_biens_20: Achat de biens avec TVA déductible 20%
- tva_deductible_services_20: Achat de services avec TVA déductible 20%
- tva_deductible_immo_20: Acquisition d'immobilisation avec TVA déductible 20%
- non_soumise: Opération non soumise à TVA
- autoliquidation_btp: BTP autoliquidation (article 283-2 nonies CGI)

Respond with: classification, base_ht, tva_amount, confidence (0-1), reasoning.`,
    response: `{
  "classification": "tva_deductible_biens_20",
  "base_ht": 10000.00,
  "tva_amount": 2000.00,
  "confidence": 0.94,
  "reasoning": "Account 601 (Achats de matières premières) combined with supplier label containing 'MATÉRIAUX' strongly indicates purchase of goods for use in production. Journal AC (Achats) confirms purchase transaction. Standard 20% TVA rate applies to raw materials in France. Base HT = 12000 / 1.20 = 10000. TVA = 2000."
}`,
    model: "claude-sonnet-4-6",
    model_version: "claude-sonnet-4-6-20251001",
    latency_ms: 834,
    confidence: 0.94,
  },
};

const REPLAY_RESPONSE = `{
  "classification": "tva_deductible_biens_20",
  "base_ht": 10000.00,
  "tva_amount": 2000.00,
  "confidence": 0.96,
  "reasoning": "Account 601XX (Matières premières) is definitively a goods purchase account per PCG français. The supplier label 'DUPONT MATÉRIAUX' confirms construction materials supply. Journal code AC (Achats) and the debit-only entry without a corresponding TVA line in the FEC suggest the TVA was included in the amount. Under article 271 CGI, TVA on goods used in taxable operations is fully deductible. Standard rate 20% applies. Base HT = 12,000.00 / 1.20 = 10,000.00. TVA déductible = 2,000.00."
}`;

type Step = "idle" | "loading" | "done";

export function ReplayDemo() {
  const [step, setStep] = useState<Step>("idle");
  const [activeTab, setActiveTab] = useState<"prompt" | "original" | "replay">("prompt");
  const [replayText, setReplayText] = useState("");

  async function handleReplay() {
    setStep("loading");
    setActiveTab("replay");
    setReplayText("");
    // Simulate streaming token-by-token
    let i = 0;
    const chars = REPLAY_RESPONSE.split("");
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        i += 3;
        setReplayText(chars.slice(0, i).join(""));
        if (i >= chars.length) {
          clearInterval(interval);
          setStep("done");
          resolve();
        }
      }, 20);
    });
  }

  const tab: React.CSSProperties = {
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    color: C.muted,
  };
  const activeTab_: React.CSSProperties = {
    ...tab,
    color: C.accent,
    borderBottomColor: C.accent,
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
      {/* Event header */}
      <div style={{
        background: "#0E1116",
        padding: "16px 20px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
      }}>
        <div>
          <span style={{
            fontFamily: "monospace",
            fontSize: 13,
            fontWeight: 700,
            color: C.accent,
          }}>
            entry.classified
          </span>
          <span style={{
            marginLeft: 12,
            fontSize: 12,
            color: C.muted,
            fontFamily: "monospace",
          }}>
            {ORIGINAL_EVENT.timestamp} · {ORIGINAL_EVENT.actor}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{
            background: "rgba(16,185,129,0.15)",
            color: "#34d399",
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 99,
            border: "1px solid rgba(16,185,129,0.3)",
          }}>
            confidence: 94%
          </span>
          <span style={{
            background: "rgba(99,102,241,0.15)",
            color: "#a5b4fc",
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 99,
            border: "1px solid rgba(99,102,241,0.3)",
          }}>
            834ms
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, paddingLeft: 8 }}>
        {[
          { id: "prompt" as const,   label: "Prompt sent" },
          { id: "original" as const, label: "Original response" },
          { id: "replay" as const,   label: "↺ Replay with current model" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={activeTab === t.id ? activeTab_ : tab}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: 20, minHeight: 300 }}>
        {activeTab === "prompt" && (
          <pre style={{
            background: "rgba(255,90,78,0.05)",
            border: `1px solid rgba(255,90,78,0.15)`,
            borderRadius: 8,
            padding: 16,
            fontSize: 12,
            lineHeight: 1.7,
            color: "#e2c4b0",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            fontFamily: "monospace",
          }}>
            {ORIGINAL_EVENT.payload.prompt}
          </pre>
        )}

        {activeTab === "original" && (
          <div>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              Response from <strong style={{ color: C.fg }}>claude-sonnet-4-6-20251001</strong> · {ORIGINAL_EVENT.payload.latency_ms}ms
            </p>
            <pre style={{
              background: "rgba(16,185,129,0.05)",
              border: `1px solid rgba(16,185,129,0.15)`,
              borderRadius: 8,
              padding: 16,
              fontSize: 12,
              lineHeight: 1.7,
              color: "#a7f3d0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              fontFamily: "monospace",
            }}>
              {ORIGINAL_EVENT.payload.response}
            </pre>
          </div>
        )}

        {activeTab === "replay" && step === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 250, gap: 16 }}>
            <p style={{ color: C.muted, fontSize: 14, margin: 0, textAlign: "center" }}>
              Re-run this exact prompt against today&apos;s model.<br />
              See if the answer changes — and why.
            </p>
            <button
              onClick={handleReplay}
              style={{
                background: C.accent,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px 28px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ↺ Replay with claude-sonnet-4-6 →
            </button>
          </div>
        )}

        {activeTab === "replay" && step !== "idle" && (
          <div>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              Re-running with <strong style={{ color: C.fg }}>claude-sonnet-4-6-20251001</strong>
              {step === "loading" && (
                <span style={{ marginLeft: 8, color: C.accent }}>● streaming…</span>
              )}
              {step === "done" && (
                <span style={{ marginLeft: 8, color: "#34d399" }}>✓ done · confidence increased: 94% → 96%</span>
              )}
            </p>
            <pre style={{
              background: "rgba(99,102,241,0.06)",
              border: `1px solid rgba(99,102,241,0.2)`,
              borderRadius: 8,
              padding: 16,
              fontSize: 12,
              lineHeight: 1.7,
              color: "#c7d2fe",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              fontFamily: "monospace",
            }}>
              {replayText}
              {step === "loading" && <span style={{ color: C.accent }}>▋</span>}
            </pre>
            {step === "done" && (
              <div style={{
                marginTop: 16,
                padding: "12px 16px",
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.2)",
                borderRadius: 8,
              }}>
                <p style={{ fontSize: 13, color: "#34d399", margin: 0 }}>
                  <strong>Result: Same classification, higher confidence.</strong> The new model provided more detailed reasoning about PCG account 601 and article 271 CGI. The classification <code>tva_deductible_biens_20</code> is confirmed.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
