"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Upload, Play, MessageSquare, ExternalLink, CheckCircle2, Clock, AlertCircle, FileText
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import type { FiscalClient, FECImport, CA3Declaration } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, Tabs } from "@/components/ui";
import { api, setToken } from "@/lib/api";
import { demoGetClient, demoGetImports, demoCreateImport, demoStartClassify } from "@/lib/demo-store";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function importStatusBadge(status: FECImport["status"]) {
  const map: Record<FECImport["status"], { variant: "default" | "success" | "warning" | "danger" | "purple"; label: string }> = {
    uploaded:   { variant: "default",  label: "Uploaded" },
    classifying:{ variant: "warning",  label: "Classifying…" },
    classified: { variant: "success",  label: "Classified" },
    error:      { variant: "danger",   label: "Error" },
  };
  const { variant, label } = map[status] ?? { variant: "default", label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

function declarationStatusBadge(status: CA3Declaration["status"]) {
  const map: Record<CA3Declaration["status"], { variant: "default" | "success" | "warning" | "danger" | "purple"; label: string }> = {
    draft:              { variant: "default",  label: "Draft" },
    pending_validation: { variant: "warning",  label: "Pending" },
    validated:          { variant: "success",  label: "Validated" },
    submitted:          { variant: "purple",   label: "Submitted" },
    error:              { variant: "danger",   label: "Error" },
  };
  const { variant, label } = map[status] ?? { variant: "default", label: status };
  return <Badge variant={variant}>{label}</Badge>;
}

function period(d: CA3Declaration) {
  const s = new Date(d.period_start);
  const e = new Date(d.period_end);
  return `${s.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} – ${e.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  client,
  declarations,
}: {
  client: FiscalClient;
  declarations: CA3Declaration[];
}) {
  const router = useRouter();
  // Build chart data from declarations sorted by period_start
  const chartData = [...declarations]
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .slice(-12)
    .map(d => ({
      name: new Date(d.period_start).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      tva_collectee: d.tva_collectee ?? 0,
      tva_deductible: d.tva_deductible_total ?? 0,
      net: d.tva_nette ?? 0,
    }));

  return (
    <div className="space-y-6">
      {/* Info cards row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Period type", value: client.period_type === "monthly" ? "Monthly" : "Quarterly" },
          { label: "SIRET", value: client.siret ?? "—" },
          { label: "Last declaration", value: fmt(client.last_declaration?.period_end) },
          { label: "Next deadline", value: fmt(client.next_deadline) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="py-3">
              <p className="text-xs" style={{ color: "var(--fg-muted)" }}>{label}</p>
              <p className="mt-1 text-sm font-semibold" style={{ color: "var(--fg)" }}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* TVA trend chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>TVA Trend (last 12 months)</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
                <XAxis dataKey="name" tick={{ fill: "#8b90a8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#8b90a8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 8 }}
                  labelStyle={{ color: "#e8eaf0" }}
                  itemStyle={{ color: "#8b90a8" }}
                />
                <Area type="monotone" dataKey="tva_collectee" name="Collected TVA" stroke="#6366f1" fill="url(#gc)" strokeWidth={2} />
                <Area type="monotone" dataKey="tva_deductible" name="Deductible TVA" stroke="#10b981" fill="url(#gd)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <div className="flex gap-3 flex-wrap">
        <Button
          variant="ghost"
          onClick={() => router.push(`/dashboard/clients/${client.id}/chat`)}
        >
          <MessageSquare size={14} />
          Open agent chat
        </Button>
      </div>
    </div>
  );
}

// ── Imports tab ───────────────────────────────────────────────────────────────

function ImportsTab({
  clientId,
  imports,
  token,
  demoMode,
}: {
  clientId: string;
  imports: FECImport[];
  token: string;
  demoMode?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [classifying, setClassifying] = useState<string | null>(null);
  const [list, setList] = useState(imports);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (demoMode) {
        // Count rows by scanning the file (demo: just use 5000 for FEC files)
        const rowsCount = file.name.toLowerCase().includes("fec") ? 5000 : 1000;
        const imp = demoCreateImport(clientId, file.name, rowsCount);
        setList(prev => [imp, ...prev]);
      } else {
        setToken(token);
        const fd = new FormData();
        fd.append("file", file);
        fd.append("fiscal_client_id", clientId);
        const result = await api.imports.upload(fd);
        if (result?.id) setList(prev => [result, ...prev]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleClassify(id: string) {
    setClassifying(id);
    if (demoMode) {
      setList(prev => prev.map(i => i.id === id ? { ...i, status: "classifying" as const } : i));
      demoStartClassify(id, () => {
        setList(prev => prev.map(i => i.id === id ? { ...i, status: "classified" as const } : i));
        setClassifying(null);
      });
      return;
    }
    setToken(token);
    try {
      await api.imports.classify(id);
      setList(prev => prev.map(i => i.id === id ? { ...i, status: "classifying" as const } : i));
      router.refresh();
    } finally {
      setClassifying(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
          {list.length} FEC file{list.length !== 1 ? "s" : ""}
        </p>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv"
            className="hidden"
            onChange={handleUpload}
            data-testid="fec-upload-input"
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload size={14} />
            {uploading ? "Uploading…" : "Upload FEC"}
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="py-16 text-center" style={{ color: "var(--fg-muted)" }}>
          <FileText size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No FEC files uploaded yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(imp => (
            <Card key={imp.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>{imp.filename}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--fg-muted)" }}>
                    {imp.rows_count != null ? `${imp.rows_count.toLocaleString()} rows · ` : ""}
                    Uploaded {fmt(imp.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {importStatusBadge(imp.status)}
                  {imp.status === "uploaded" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={classifying === imp.id}
                      onClick={() => handleClassify(imp.id)}
                      data-testid="classify-btn"
                    >
                      <Play size={12} />
                      {classifying === imp.id ? "Starting…" : "Classify"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Declarations tab ──────────────────────────────────────────────────────────

function DeclarationsTab({ declarations }: { declarations: CA3Declaration[] }) {
  const router = useRouter();
  const sorted = [...declarations].sort((a, b) => b.period_start.localeCompare(a.period_start));

  return (
    <div className="space-y-2">
      {sorted.length === 0 ? (
        <div className="py-16 text-center" style={{ color: "var(--fg-muted)" }}>
          <FileText size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No declarations yet. Use the agent chat to compute a CA3.</p>
        </div>
      ) : (
        sorted.map(d => (
          <Card
            key={d.id}
            className="cursor-pointer transition-all hover:border-indigo-500/50"
            onClick={() => router.push(`/dashboard/declarations/${d.id}`)}
          >
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>{period(d)}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--fg-muted)" }}>
                  {d.tva_nette != null
                    ? `Net TVA: ${d.tva_nette < 0 ? "Credit " + Math.abs(d.tva_nette).toFixed(2) : d.tva_nette.toFixed(2)} €`
                    : "TVA not yet computed"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {declarationStatusBadge(d.status)}
                <ExternalLink size={14} style={{ color: "var(--fg-muted)" }} />
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function ClientDetailClient({
  client: clientProp,
  imports,
  declarations,
  token,
  demoMode,
}: {
  client: FiscalClient;
  imports: FECImport[];
  declarations: CA3Declaration[];
  token: string;
  demoMode?: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("overview");
  const [client, setClient] = useState(clientProp);

  // In demo mode, hydrate client data from localStorage on mount
  useEffect(() => {
    if (!demoMode) return;
    const stored = demoGetClient(clientProp.id);
    if (stored) setClient(stored);
  }, [demoMode, clientProp.id]);

  const tabs = [
    { id: "overview",      label: "Overview" },
    { id: "imports",       label: `Imports (${imports.length})` },
    { id: "declarations",  label: `Declarations (${declarations.length})` },
  ];

  return (
    <div className="px-8 py-8">
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-1 text-sm transition-colors"
          style={{ color: "var(--fg-muted)" }}
        >
          <ArrowLeft size={14} />
          Dashboard
        </button>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--fg)" }}>{client.name}</h1>
          {client.siret && (
            <p className="text-sm mt-0.5" style={{ color: "var(--fg-muted)" }}>SIRET: {client.siret}</p>
          )}
        </div>
        <Button onClick={() => router.push(`/dashboard/clients/${client.id}/chat`)}>
          <MessageSquare size={14} />
          Agent chat
        </Button>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="mt-6">
        {activeTab === "overview" && (
          <OverviewTab client={client} declarations={declarations} />
        )}
        {activeTab === "imports" && (
          <ImportsTab clientId={client.id} imports={demoMode ? demoGetImports(client.id) : imports} token={token} demoMode={demoMode} />
        )}
        {activeTab === "declarations" && (
          <DeclarationsTab declarations={declarations} />
        )}
      </div>
    </div>
  );
}
