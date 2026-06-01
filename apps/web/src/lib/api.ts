/**
 * Typed API client for Stratus backend.
 * All requests attach the Clerk JWT from session.
 */
import type { FiscalClient, FECImport, CA3Declaration } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Auth ──────────────────────────────────────────────────────────────────────

let _token: string | null = null;

/** Call once from a client component with the Clerk session token. */
export function setToken(token: string | null) {
  _token = token;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(_token ? { Authorization: `Bearer ${_token}` } : {}),
    ...extra,
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── FiscalClients ─────────────────────────────────────────────────────────────

export const api = {
  clients: {
    list: () => apiFetch<FiscalClient[]>("/fiscal-clients"),
    get:  (id: string) => apiFetch<FiscalClient>(`/fiscal-clients/${id}`),
    create: (data: Partial<FiscalClient>) =>
      apiFetch<FiscalClient>("/fiscal-clients", { method: "POST", body: JSON.stringify(data) }),
  },

  imports: {
    list:    () => apiFetch<FECImport[]>("/v1/fec-imports"),
    get:     (id: string) => apiFetch<FECImport>(`/v1/fec-imports/${id}`),
    classify:(id: string) => apiFetch<{ status: string }>(`/v1/fec-imports/${id}/classify`, { method: "POST" }),
    upload:  (formData: FormData) =>
      fetch(`${API_BASE}/v1/fec-imports`, {
        method: "POST",
        body: formData,
        headers: _token ? { Authorization: `Bearer ${_token}` } : {},
      }).then((r) => r.json()),
  },

  declarations: {
    get: (id: string) => apiFetch<CA3Declaration>(`/v1/declarations/${id}`),
    validate: (id: string) => apiFetch<CA3Declaration>(`/v1/declarations/${id}/validate`, { method: "POST" }),
    generateXml: (id: string) =>
      fetch(`${API_BASE}/v1/declarations/${id}/replay-bundle`, {
        headers: _token ? { Authorization: `Bearer ${_token}` } : {},
      }),
  },

  agent: {
    createSession: (data: {
      org_id: string;
      fiscal_client_id: string;
      user_id?: string;
      period_type?: string;
      fec_import_id?: string;
    }) => apiFetch<{ session_id: string; phase: string }>("/v1/agent/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    getState: (sessionId: string) =>
      apiFetch<{ session_id: string; phase: string; node_call_count: number; ca3_ready: boolean; xml_ready: boolean }>(`/v1/agent/sessions/${sessionId}/state`),
    /** Returns a ReadableStream for SSE — caller reads chunks */
    sendMessage: (sessionId: string, message: string): EventSource => {
      // POST via fetch SSE — use EventSource workaround
      // We return an EventSource-compatible object via a helper endpoint
      throw new Error("Use streamMessage() instead");
    },
    streamMessage: (sessionId: string, message: string, token: string | null): Promise<Response> =>
      fetch(`${API_BASE}/v1/agent/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, role: "user" }),
      }),
  },
};
