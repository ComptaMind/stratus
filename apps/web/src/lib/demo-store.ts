/**
 * Demo mode — all data lives in localStorage.
 * Used when the NestJS API is unreachable (offline / demo without backend).
 */
import type { FiscalClient, FECImport } from "./types";

const KEY = "stratus_demo_v1";

interface DemoData {
  clients: Record<string, FiscalClient>;
  imports: Record<string, FECImport>;
}

function load(): DemoData {
  if (typeof window === "undefined") return { clients: {}, imports: {} };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : { clients: {}, imports: {} };
  } catch {
    return { clients: {}, imports: {} };
  }
}

function save(data: DemoData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function isDemoId(id: string) {
  return id.startsWith("demo-");
}

// ── Clients ───────────────────────────────────────────────────────────────────

export function demoCreateClient(input: {
  name: string;
  siret?: string;
  period_type: "monthly" | "quarterly";
}): FiscalClient {
  const d = load();
  const id = `demo-${Date.now()}`;
  const now = new Date().toISOString();
  const client: FiscalClient = {
    id,
    org_id: "demo-org",
    name: input.name,
    siret: input.siret,
    period_type: input.period_type,
    status: "no_data",
    tva_position: "zero",
    last_declaration: null,
    next_deadline: null,
    created_at: now,
    updated_at: now,
  };
  d.clients[id] = client;
  save(d);
  return client;
}

export function demoGetClient(id: string): FiscalClient | null {
  return load().clients[id] ?? null;
}

// ── Imports ───────────────────────────────────────────────────────────────────

export function demoCreateImport(clientId: string, filename: string, rowsCount: number): FECImport {
  const d = load();
  const id = `demo-imp-${Date.now()}`;
  const now = new Date().toISOString();
  const imp: FECImport = {
    id,
    fiscal_client_id: clientId,
    filename,
    status: "uploaded",
    rows_count: rowsCount,
    created_at: now,
    updated_at: now,
  };
  d.imports[id] = imp;
  save(d);
  return imp;
}

export function demoGetImports(clientId: string): FECImport[] {
  const d = load();
  return Object.values(d.imports).filter(i => i.fiscal_client_id === clientId);
}

export function demoStartClassify(importId: string, onClassified: () => void): void {
  const d = load();
  if (!d.imports[importId]) return;
  d.imports[importId] = { ...d.imports[importId], status: "classifying" };
  save(d);
  // Simulate ~3 second classify job
  setTimeout(() => {
    const d2 = load();
    if (d2.imports[importId]) {
      d2.imports[importId] = { ...d2.imports[importId], status: "classified", classified_at: new Date().toISOString() };
      save(d2);
      onClassified();
    }
  }, 3000);
}

export function demoUpdateImportStatus(importId: string, status: FECImport["status"]): void {
  const d = load();
  if (d.imports[importId]) {
    d.imports[importId] = { ...d.imports[importId], status };
    save(d);
  }
}
