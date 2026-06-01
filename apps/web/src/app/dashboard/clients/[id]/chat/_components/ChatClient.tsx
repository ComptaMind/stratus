"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, ArrowLeft, Bot, User, Loader2, ChevronRight, Zap, AlertTriangle, ExternalLink, Table2, Download } from "lucide-react";
import type { FiscalClient, ChatMessage, AgentSession, BofipSource, Ca3Warning } from "@/lib/types";
import { Button, Card, CardContent, CardHeader, Spinner, Badge } from "@/components/ui";
import { api, setToken } from "@/lib/api";
import { createDemoSSEResponse } from "@/lib/demo-sse";
import { demoGetClient } from "@/lib/demo-store";

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Compute CA3 for January 2026",
  "What is the TVA position for this period?",
  "Show me the classified transactions",
  "Are there any anomalies in the FEC?",
  "Show me your reasoning on line 16",
];

// ── CA3 table labels ───────────────────────────────────────────────────────────

const CA3_LABELS: Record<string, string> = {
  L08:  "CA taxable 20%",
  L09:  "CA taxable 10%",
  L09B: "CA taxable 5,5%",
  L10:  "Opérations non imposables",
  L16:  "TVA brute 20%",
  L17:  "TVA brute 10%",
  L17B: "TVA brute 5,5%",
  L18:  "TVA sur acquisitions intracommunautaires",
  L14:  "TVA sur autoliquidations",
  L19:  "Total TVA brute",
  L20:  "TVA déductible (immobilisations)",
  L21:  "TVA déductible (autres biens & services)",
  L22:  "Total TVA déductible",
  L23:  "Crédit TVA période précédente",
  L24:  "TVA nette due",
  L25:  "Crédit de TVA",
};

const CA3_SECTION_BREAKS: Record<string, string> = {
  L08:  "Cadre A — Chiffre d'affaires",
  L16:  "Cadre B — TVA brute",
  L20:  "Cadre C — TVA déductible",
  L24:  "Cadre D — Solde",
};

// ── CA3 table card ─────────────────────────────────────────────────────────────

function Ca3TableCard({ lines, warnings }: { lines: Record<string, string>; warnings?: Ca3Warning[] }) {
  const rows = Object.entries(CA3_LABELS)
    .filter(([key]) => key in lines)
    .map(([key, label]) => ({ key, label, value: lines[key] ?? "0.00" }));

  const errors   = warnings?.filter(w => w.severity === "error")   ?? [];
  const warnList = warnings?.filter(w => w.severity === "warning")  ?? [];

  return (
    <div
      className="rounded-xl border overflow-hidden text-sm mt-1"
      style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ borderColor: "var(--border)", background: "rgba(99,102,241,0.07)" }}
      >
        <Table2 size={13} style={{ color: "var(--accent)" }} />
        <span className="font-semibold text-xs" style={{ color: "var(--fg)" }}>
          CA3 — CERFA 3310-CA3-SD
        </span>
      </div>

      {/* Warnings */}
      {(errors.length > 0 || warnList.length > 0) && (
        <div className="px-4 py-2.5 border-b space-y-1" style={{ borderColor: "var(--border)" }}>
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-500" />
              <span className="text-xs text-red-600">{e.message}</span>
            </div>
          ))}
          {warnList.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
              <span className="text-xs text-amber-700">{w.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <table className="w-full">
        <tbody>
          {rows.map(({ key, label, value }) => {
            const sectionLabel = CA3_SECTION_BREAKS[key];
            const isTotal = key === "L19" || key === "L22" || key === "L24" || key === "L25";
            const isCredit = key === "L25";
            const isDue    = key === "L24";
            return (
              <>
                {sectionLabel && (
                  <tr key={`sec-${key}`}>
                    <td
                      colSpan={3}
                      className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {sectionLabel}
                    </td>
                  </tr>
                )}
                <tr
                  key={key}
                  style={{
                    background: isTotal ? "rgba(99,102,241,0.05)" : undefined,
                  }}
                >
                  <td
                    className="px-4 py-1.5 font-mono text-xs"
                    style={{ color: "var(--fg-muted)", minWidth: "4rem" }}
                  >
                    {key}
                  </td>
                  <td className="px-2 py-1.5 text-xs flex-1" style={{ color: "var(--fg)" }}>
                    {label}
                  </td>
                  <td
                    className={`px-4 py-1.5 text-right text-xs font-mono tabular-nums ${isTotal ? "font-bold" : ""}`}
                    style={{
                      color: isCredit
                        ? "var(--success, #22c55e)"
                        : isDue
                        ? "var(--accent)"
                        : "var(--fg)",
                    }}
                  >
                    {parseFloat(value).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €
                  </td>
                </tr>
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── BOFiP sources card ─────────────────────────────────────────────────────────

function SourcesCard({ sources }: { sources: BofipSource[] }) {
  if (!sources.length) return null;
  return (
    <div
      className="rounded-lg border mt-2 text-xs overflow-hidden"
      style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
    >
      <div
        className="px-3 py-2 border-b font-semibold text-xs"
        style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
      >
        Sources BOFiP utilisées
      </div>
      {sources.map((s, i) => (
        <a
          key={i}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 transition-colors"
          style={{ color: "var(--fg)", borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
        >
          <ExternalLink size={10} className="shrink-0" style={{ color: "var(--accent)" }} />
          <span className="flex-1 truncate">{s.title}</span>
          <span className="shrink-0 tabular-nums" style={{ color: "var(--fg-muted)" }}>
            {Math.round(s.score * 100)}%
          </span>
        </a>
      ))}
    </div>
  );
}

// ── CA3 XML download ──────────────────────────────────────────────────────────

function downloadCa3Xml(lines: Record<string, string>, clientName: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- CA3 — CERFA 3310-CA3-SD | Generated by Stratus on ${now.toISOString()} -->
<DeclarationTVA xmlns="urn:stratus:ca3:1.0">
  <Emetteur>
    <Denomination>${clientName}</Denomination>
    <DateGeneration>${dateStr}</DateGeneration>
    <Logiciel>Stratus</Logiciel>
  </Emetteur>
  <Declaration>
    <Periode>01/01/2026 - 31/01/2026</Periode>
    <Cadre id="A" label="Chiffre d affaires">
      <Ligne id="L08" label="CA taxable 20%">${lines.L08 ?? "0.00"}</Ligne>
    </Cadre>
    <Cadre id="B" label="TVA brute">
      <Ligne id="L14" label="TVA autoliquidation">${lines.L14 ?? "0.00"}</Ligne>
      <Ligne id="L16" label="TVA brute 20%">${lines.L16 ?? "0.00"}</Ligne>
      <Ligne id="L18" label="TVA intra-UE">${lines.L18 ?? "0.00"}</Ligne>
      <Ligne id="L19" label="Total TVA brute">${lines.L19 ?? "0.00"}</Ligne>
    </Cadre>
    <Cadre id="C" label="TVA deductible">
      <Ligne id="L20" label="TVA ded. immobilisations">${lines.L20 ?? "0.00"}</Ligne>
      <Ligne id="L21" label="TVA ded. biens et services">${lines.L21 ?? "0.00"}</Ligne>
      <Ligne id="L22" label="Total TVA deductible">${lines.L22 ?? "0.00"}</Ligne>
    </Cadre>
    <Cadre id="D" label="Solde">
      <Ligne id="L23" label="Credit periode precedente">0.00</Ligne>
      <Ligne id="L24" label="TVA nette due">${lines.L24 ?? "0.00"}</Ligne>
    </Cadre>
  </Declaration>
</DeclarationTVA>`;

  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ca3_2026-01-01_2026-01-31.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs"
        style={{
          background: isUser ? "var(--accent)" : "var(--bg-input)",
          color: isUser ? "#fff" : "var(--fg-muted)",
        }}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content column */}
      <div className={`flex flex-col max-w-[80%] gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {/* Text bubble */}
        {(msg.content || msg.streaming) && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.streaming ? "streaming" : ""
            } ${isUser ? "rounded-tr-sm" : "rounded-tl-sm"}`}
            style={{
              background: isUser ? "var(--accent)" : "var(--bg-card)",
              color: isUser ? "#fff" : "var(--fg)",
              border: isUser ? "none" : "1px solid var(--border)",
            }}
          >
            {msg.content || (msg.streaming ? "" : "…")}
          </div>
        )}

        {/* CA3 table + download */}
        {msg.ca3Lines && (
          <>
            <Ca3TableCard lines={msg.ca3Lines} warnings={msg.ca3Warnings} />
            <button
              type="button"
              onClick={() => downloadCa3Xml(msg.ca3Lines!, "Cabinet Dupont & Associés")}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-indigo-500/50"
              style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
              data-testid="download-ca3-xml"
            >
              <Download size={11} />
              Download CA3 XML (EDI-TVA)
            </button>
          </>
        )}

        {/* BOFiP sources */}
        {msg.sources && msg.sources.length > 0 && (
          <SourcesCard sources={msg.sources} />
        )}
      </div>
    </div>
  );
}

// ── Context panel ─────────────────────────────────────────────────────────────

function ContextPanel({
  session,
  client,
}: {
  session: AgentSession | null;
  client: FiscalClient;
}) {
  return (
    <aside
      className="hidden lg:flex w-64 shrink-0 flex-col border-l"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      data-testid="context-panel"
    >
      <div className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
          Session
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Client info */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--fg-muted)" }}>Client</p>
          <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>{client.name}</p>
          {client.siret && (
            <p className="text-xs mt-0.5" style={{ color: "var(--fg-muted)" }}>{client.siret}</p>
          )}
        </div>

        {/* Session state */}
        {session ? (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--fg-muted)" }}>Agent state</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Phase</span>
                <Badge variant="purple">{session.phase}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Steps</span>
                <span className="text-xs" style={{ color: "var(--fg)" }}>{session.node_call_count}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--fg-muted)" }}>CA3 ready</span>
                <Badge variant={session.ca3_ready ? "success" : "default"}>
                  {session.ca3_ready ? "Yes" : "No"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--fg-muted)" }}>XML ready</span>
                <Badge variant={session.xml_ready ? "success" : "default"}>
                  {session.xml_ready ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs" style={{ color: "var(--fg-muted)" }}>No active session</p>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChatClient({
  client: clientProp,
  token,
  demoMode,
}: {
  client: FiscalClient;
  token: string;
  demoMode?: boolean;
}) {
  const router = useRouter();
  const [client, setClient] = useState(clientProp);

  // In demo mode, hydrate client name from localStorage after mount
  useEffect(() => {
    if (!demoMode) return;
    const stored = demoGetClient(clientProp.id);
    if (stored) setClient(stored);
  }, [demoMode, clientProp.id]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `Hello! I'm your fiscal agent for **${clientProp.name || clientProp.id}**. I can help you classify FEC transactions, compute CA3 declarations, and generate EDI-TVA XML. What would you like to do?`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    if (demoMode) {
      const fakeId = `demo-session-${Date.now()}`;
      setSessionId(fakeId);
      setSession({ session_id: fakeId, phase: "idle", node_call_count: 0, ca3_ready: false, xml_ready: false });
      return fakeId;
    }
    setToken(token);
    const sess = await api.agent.createSession({
      org_id: "demo",
      fiscal_client_id: client.id,
    });
    setSessionId(sess.session_id);
    return sess.session_id;
  }, [sessionId, token, client.id, demoMode]);

  const pollSession = useCallback(async (sid: string) => {
    try {
      const state = await api.agent.getState(sid);
      setSession(state);
    } catch {
      // ignore polling errors
    }
  }, []);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    setInput("");
    setLoading(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Placeholder streaming message
    const assistantId = crypto.randomUUID();
    setMessages(prev => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", streaming: true, timestamp: new Date() },
    ]);

    try {
      const sid = await ensureSession();
      // Build plain-text history for context (last 10 messages, skip welcome)
      const historyForApi = messages
        .filter((m) => m.id !== "welcome")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = demoMode
        ? await createDemoSSEResponse(text, historyForApi)
        : await api.agent.streamMessage(sid, text, token);

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      // Pending structured data from SSE events
      let pendingCa3Lines: Record<string, string> | null = null;
      let pendingCa3Warnings: Ca3Warning[] | null = null;
      let pendingSources: BofipSource[] | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]" || data === '{"type":"done"}') break;
          try {
            const parsed = JSON.parse(data);

            switch (parsed.type) {
              // ── Text delta ───────────────────────────────────────────────────
              case "delta": {
                const delta = parsed.content ?? "";
                if (delta) {
                  accumulated += delta;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, content: accumulated } : m,
                    ),
                  );
                }
                break;
              }

              // ── CA3 structured table ─────────────────────────────────────────
              case "ca3": {
                pendingCa3Lines = parsed.lines ?? null;
                break;
              }

              // ── CA3 validation issues ────────────────────────────────────────
              case "ca3_validation": {
                pendingCa3Warnings = parsed.validation ?? null;
                break;
              }

              // ── BOFiP sources ────────────────────────────────────────────────
              case "sources": {
                pendingSources = parsed.sources ?? null;
                break;
              }

              // ── Agent state update ───────────────────────────────────────────
              case "state": {
                if (parsed.phase != null) {
                  setSession(prev =>
                    prev
                      ? {
                          ...prev,
                          phase: parsed.phase,
                          node_call_count: parsed.node_call_count ?? prev.node_call_count,
                          ca3_ready: parsed.ca3_ready ?? prev.ca3_ready,
                          xml_ready: parsed.xml_ready ?? prev.xml_ready,
                        }
                      : null,
                  );
                }
                break;
              }

              // ── Fallback: plain content delta (OpenAI-compat format) ─────────
              default: {
                const delta =
                  parsed?.choices?.[0]?.delta?.content ??
                  parsed?.content ??
                  parsed?.text ?? "";
                if (delta) {
                  accumulated += delta;
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === assistantId ? { ...m, content: accumulated } : m,
                    ),
                  );
                }
              }
            }
          } catch {
            // non-JSON line — append raw if non-empty
            if (data && data !== "[DONE]") {
              accumulated += data + " ";
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: accumulated } : m,
                ),
              );
            }
          }
        }
      }

      // ── Finalize: apply collected structured data ──────────────────────────
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== assistantId) return m;
          return {
            ...m,
            content: accumulated || (pendingCa3Lines ? "" : "(no response)"),
            streaming: false,
            ca3Lines: pendingCa3Lines ?? undefined,
            ca3Warnings: pendingCa3Warnings ?? undefined,
            sources: pendingSources ?? undefined,
          };
        }),
      );

      // Poll session state after response (skip in demo mode)
      if (!demoMode) await pollSession(sid);
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: "Error: " + (err instanceof Error ? err.message : "Unknown error"), streaming: false }
            : m,
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--bg)" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 border-b px-6 py-3 shrink-0"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => router.push(`/dashboard/clients/${client.id}`)}
          className="rounded-lg p-1.5 transition-colors"
          style={{ color: "var(--fg-muted)" }}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgba(99,102,241,0.15)" }}
          >
            <Zap size={14} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--fg)" }}>{client.name}</p>
            <p className="text-xs" style={{ color: "var(--fg-muted)" }}>Fiscal agent</p>
          </div>
        </div>
        {loading && (
          <div className="ml-auto flex items-center gap-1.5">
            <Spinner size={14} />
            <span className="text-xs" style={{ color: "var(--fg-muted)" }}>Thinking…</span>
          </div>
        )}
      </div>

      {/* Body: messages + context panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Message thread */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips (only when no conversation yet) */}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2 px-6 pb-3">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendMessage(s)}
                  className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors hover:border-indigo-500/50"
                  style={{ borderColor: "var(--border)", color: "var(--fg-muted)" }}
                  data-testid="suggestion-chip"
                >
                  <ChevronRight size={10} />
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div
            className="border-t px-6 py-4 shrink-0"
            style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
          >
            <div
              className="flex items-end gap-2 rounded-xl border px-3 py-2"
              style={{ background: "var(--bg-input)", borderColor: "var(--border)" }}
            >
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask your fiscal agent…"
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm outline-none leading-relaxed"
                style={{ color: "var(--fg)", maxHeight: 120 }}
                data-testid="chat-input"
              />
              <button
                type="button"
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="rounded-lg p-2 transition-colors disabled:opacity-40"
                style={{ background: "var(--accent)", color: "#fff" }}
                data-testid="chat-send-btn"
              >
                <Send size={14} />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-center" style={{ color: "var(--fg-muted)" }}>
              Press Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>

        <ContextPanel session={session} client={client} />
      </div>
    </div>
  );
}
