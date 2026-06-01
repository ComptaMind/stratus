"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, AlertCircle, CheckCircle2, Clock, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { FiscalClient } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, Modal, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { demoCreateClient } from "@/lib/demo-store";

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: FiscalClient["status"]) {
  if (status === "up_to_date") return <Badge variant="success">Up to date</Badge>;
  if (status === "late") return <Badge variant="danger">Late</Badge>;
  return <Badge variant="default">No data</Badge>;
}

function tvaPositionIcon(pos: FiscalClient["tva_position"]) {
  if (pos === "debit")  return <TrendingDown size={14} className="text-red-400" />;
  if (pos === "credit") return <TrendingUp size={14} className="text-emerald-400" />;
  return <Minus size={14} className="text-[#4b5168]" />;
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Add Client Modal ──────────────────────────────────────────────────────────

function AddClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: FiscalClient) => void }) {
  const [name, setName] = useState("");
  const [siret, setSiret] = useState("");
  const [period, setPeriod] = useState<"monthly" | "quarterly">("monthly");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const client = await api.clients.create({ name: name.trim(), siret: siret.trim() || undefined, period_type: period });
      onCreated(client);
      setName(""); setSiret(""); setPeriod("monthly");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const msgLower = msg.toLowerCase();
      const isNetwork = msgLower.includes("fetch") || msgLower.includes("load failed") || msgLower.includes("networkerror") || msgLower.includes("econnrefused") || msgLower.includes("network request failed");
      if (isNetwork) {
        // API unreachable — fall back to demo mode (localStorage)
        const client = demoCreateClient({ name: name.trim(), siret: siret.trim() || undefined, period_type: period });
        onCreated(client);
        setName(""); setSiret(""); setPeriod("monthly");
        return;
      }
      setError(msg || "Failed to create client");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Fiscal Client">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Company name *" value={name} onChange={e => setName(e.target.value)} placeholder="Acme SAS" required />
        <Input label="SIRET (optional)" value={siret} onChange={e => setSiret(e.target.value)} placeholder="12345678901234" maxLength={14} />
        <Select
          label="VAT period"
          value={period}
          onChange={e => setPeriod(e.target.value as "monthly" | "quarterly")}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "quarterly", label: "Quarterly" },
          ]}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? "Creating…" : "Create client"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Client Card ───────────────────────────────────────────────────────────────

function ClientCard({ client }: { client: FiscalClient }) {
  const router = useRouter();
  const last = client.last_declaration;

  return (
    <Card
      className="cursor-pointer transition-all hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-950/20"
      onClick={() => router.push(`/dashboard/clients/${client.id}`)}
    >
      <CardHeader className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: "var(--fg)" }}>{client.name}</p>
          {client.siret && (
            <p className="text-xs mt-0.5" style={{ color: "var(--fg-muted)" }}>SIRET: {client.siret}</p>
          )}
        </div>
        {statusBadge(client.status)}
      </CardHeader>

      <CardContent className="grid grid-cols-2 gap-3 pt-0">
        {/* Last declaration */}
        <div>
          <p className="text-xs mb-0.5" style={{ color: "var(--fg-muted)" }}>Last declaration</p>
          <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>
            {last ? formatDate(last.period_end) : "—"}
          </p>
        </div>

        {/* Next deadline */}
        <div>
          <p className="text-xs mb-0.5" style={{ color: "var(--fg-muted)" }}>Next deadline</p>
          <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>
            {formatDate(client.next_deadline)}
          </p>
        </div>

        {/* TVA position */}
        <div>
          <p className="text-xs mb-0.5" style={{ color: "var(--fg-muted)" }}>TVA position</p>
          <div className="flex items-center gap-1">
            {tvaPositionIcon(client.tva_position)}
            <span className="text-sm font-medium" style={{ color: "var(--fg)" }}>
              {client.tva_position === "debit"  ? "Amount due" :
               client.tva_position === "credit" ? "Credit" : "Zero"}
            </span>
          </div>
        </div>

        {/* Period type */}
        <div>
          <p className="text-xs mb-0.5" style={{ color: "var(--fg-muted)" }}>Frequency</p>
          <p className="text-sm font-medium capitalize" style={{ color: "var(--fg)" }}>
            {client.period_type}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardClient({ initialClients }: { initialClients: FiscalClient[] }) {
  const [clients, setClients] = useState(initialClients);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--fg)" }}>Fiscal Clients</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--fg-muted)" }}>
            {clients.length} client{clients.length !== 1 ? "s" : ""} tracked
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} />
          Add client
        </Button>
      </div>

      {/* Grid */}
      {clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <div className="text-5xl text-[#4b5168]">🏢</div>
          <p className="font-medium" style={{ color: "var(--fg)" }}>No clients yet</p>
          <p className="text-sm max-w-xs" style={{ color: "var(--fg-muted)" }}>
            Add your first fiscal client to start tracking TVA declarations.
          </p>
          <Button className="mt-2" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add client
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map(c => <ClientCard key={c.id} client={c} />)}
        </div>
      )}

      <AddClientModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={c => { setClients(prev => [c, ...prev]); setShowAdd(false); }}
      />
    </div>
  );
}
