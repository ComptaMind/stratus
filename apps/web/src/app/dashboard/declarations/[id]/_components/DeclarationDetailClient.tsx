"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, CheckCircle2, FileText, AlertTriangle } from "lucide-react";
import type { CA3Declaration } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, Spinner, Tabs } from "@/components/ui";
import { api, setToken } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function eur(v?: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v);
}

function statusBadge(status: CA3Declaration["status"]) {
  const map: Record<CA3Declaration["status"], { variant: "default" | "success" | "warning" | "danger" | "purple"; label: string }> = {
    draft:              { variant: "default",  label: "Draft" },
    pending_validation: { variant: "warning",  label: "Pending validation" },
    validated:          { variant: "success",  label: "Validated" },
    submitted:          { variant: "purple",   label: "Submitted" },
    error:              { variant: "danger",   label: "Error" },
  };
  const { variant, label } = map[status] ?? { variant: "default", label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

// ── CA3 Form section ──────────────────────────────────────────────────────────

function FormRow({
  label,
  value,
  highlight,
  negative,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 px-3 rounded-lg ${highlight ? "border" : ""}`}
      style={
        highlight
          ? { background: "rgba(99,102,241,0.08)", borderColor: "rgba(99,102,241,0.3)" }
          : {}
      }
    >
      <span className="text-sm" style={{ color: "var(--fg-muted)" }}>{label}</span>
      <span
        className="text-sm font-semibold tabular-nums"
        style={{
          color: negative
            ? "var(--success)"
            : highlight
            ? "var(--accent)"
            : "var(--fg)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CA3Form({ d }: { d: CA3Declaration }) {
  return (
    <div className="space-y-6">
      {/* Section A — Turnover */}
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
            Section A — Turnover (HT)
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          <FormRow label="CA taxable at 20%" value={eur(d.ca_ht_20)} />
          <FormRow label="CA taxable at 10%" value={eur(d.ca_ht_10)} />
          <FormRow label="CA taxable at 5.5%" value={eur(d.ca_ht_55)} />
          <FormRow label="CA exempt / 0%" value={eur(d.ca_ht_0)} />
        </CardContent>
      </Card>

      {/* Section B — TVA collected */}
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
            Section B — TVA Collected
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          <FormRow label="TVA at 20%" value={eur(d.tva_20)} />
          <FormRow label="TVA at 10%" value={eur(d.tva_10)} />
          <FormRow label="TVA at 5.5%" value={eur(d.tva_55)} />
          <FormRow label="Total TVA collected" value={eur(d.tva_collectee)} highlight />
        </CardContent>
      </Card>

      {/* Section C — TVA deductible */}
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
            Section C — TVA Deductible
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          <FormRow label="On fixed assets" value={eur(d.tva_deductible_immo)} />
          <FormRow label="On other goods & services" value={eur(d.tva_deductible_biens)} />
          <FormRow label="On services" value={eur(d.tva_deductible_services)} />
          <FormRow label="Total TVA deductible" value={eur(d.tva_deductible_total)} highlight />
        </CardContent>
      </Card>

      {/* Section D — Net TVA */}
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
            Section D — Result
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {d.credit_tva_precedent != null && (
            <FormRow label="Previous credit brought forward" value={eur(d.credit_tva_precedent)} />
          )}
          <FormRow label="Net TVA" value={eur(d.tva_nette)} />
          {(d.net_a_payer ?? 0) > 0 ? (
            <FormRow label="Amount due (net à payer)" value={eur(d.net_a_payer)} highlight />
          ) : (
            <FormRow label="Credit to carry forward" value={eur(d.credit_a_reporter)} highlight negative />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────────────────────────

function ActionsPanel({
  declaration,
  token,
}: {
  declaration: CA3Declaration;
  token: string;
}) {
  const router = useRouter();
  const [validating, setValidating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD] = useState(declaration);

  async function handleValidate() {
    setValidating(true);
    setError(null);
    setToken(token);
    try {
      const updated = await api.declarations.validate(d.id);
      setD(updated);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  async function handleGenerateXml() {
    setGenerating(true);
    setError(null);
    setToken(token);
    try {
      const res = await api.declarations.generateXml(d.id);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ca3_${d.period_start}_${d.period_end}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "XML generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const canValidate = d.status === "draft" || d.status === "pending_validation";
  const canGenerate = d.status === "validated" || d.status === "submitted";

  return (
    <div className="space-y-3">
      {error && (
        <div
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.3)", color: "#f87171" }}
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <Button
        className="w-full"
        disabled={!canValidate || validating}
        onClick={handleValidate}
        data-testid="validate-btn"
      >
        {validating ? <Spinner size={14} /> : <CheckCircle2 size={14} />}
        {validating ? "Validating…" : "Validate declaration"}
      </Button>

      <Button
        className="w-full"
        variant="ghost"
        disabled={!canGenerate || generating}
        onClick={handleGenerateXml}
        data-testid="generate-xml-btn"
      >
        {generating ? <Spinner size={14} /> : <Download size={14} />}
        {generating ? "Generating…" : "Download EDI-TVA XML"}
      </Button>

      {d.xml_url && (
        <p className="text-xs text-center" style={{ color: "var(--success)" }}>
          XML generated · <a href={d.xml_url} target="_blank" rel="noopener noreferrer" className="underline">View file</a>
        </p>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function DeclarationDetailClient({
  declaration,
  token,
}: {
  declaration: CA3Declaration;
  token: string;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("form");

  const period = `${fmt(declaration.period_start)} – ${fmt(declaration.period_end)}`;

  const tabs = [
    { id: "form",  label: "CA3 Form" },
    { id: "audit", label: "Audit Trail" },
  ];

  return (
    <div className="px-8 py-8">
      {/* Breadcrumb */}
      <button
        type="button"
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm mb-2 transition-colors"
        style={{ color: "var(--fg-muted)" }}
      >
        <ArrowLeft size={14} />
        Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold" style={{ color: "var(--fg)" }}>CA3 Declaration</h1>
            {statusBadge(declaration.status)}
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--fg-muted)" }}>{period}</p>
          {declaration.validated_at && (
            <p className="text-xs mt-0.5" style={{ color: "var(--fg-muted)" }}>
              Validated {fmt(declaration.validated_at)}
            </p>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="mt-6">
        {activeTab === "form" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
            <CA3Form d={declaration} />
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Actions</p>
                </CardHeader>
                <CardContent>
                  <ActionsPanel declaration={declaration} token={token} />
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="text-center py-16" style={{ color: "var(--fg-muted)" }}>
            <FileText size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              <a
                href={`/dashboard/declarations/${declaration.id}/audit`}
                className="underline"
                style={{ color: "var(--accent)" }}
              >
                View full audit trail →
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
