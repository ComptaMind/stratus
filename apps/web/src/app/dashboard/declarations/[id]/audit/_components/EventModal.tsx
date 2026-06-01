"use client";

import { useState } from "react";
import type { AuditEvent } from "./EventCard";
import { RerunPanel } from "./RerunPanel";

type Props = {
  event: AuditEvent;
  declarationId: string;
  onClose: () => void;
};

type Tab = "payload" | "prompt" | "sources" | "rerun";

export function EventModal({ event, declarationId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("payload");

  const payload = event.payload;
  const hasPrompt = typeof payload.prompt === "string" || typeof payload.response === "string";
  const hasRAG =
    Array.isArray(payload.retrieved_chunks) ||
    Array.isArray(payload.chunks) ||
    Array.isArray(payload.sources);

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "payload",  label: "Payload",  show: true },
    { id: "prompt",   label: "Prompt / Réponse LLM", show: hasPrompt },
    { id: "sources",  label: "Sources BOFiP",         show: hasRAG },
    { id: "rerun",    label: "↺ Rejouer avec Claude", show: hasPrompt },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 flex w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="font-mono text-base font-semibold text-gray-900">
              {event.action}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {new Date(event.createdAt).toISOString()} · {event.actorType} / {event.actorId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <span className="sr-only">Fermer</span>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 px-6 pt-3">
          {tabs.filter((t) => t.show).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? "border-b-2 border-indigo-500 pb-2 text-sm font-medium text-indigo-600"
                  : "pb-2 text-sm text-gray-500 hover:text-gray-700"
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {tab === "payload" && (
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-4 text-xs text-gray-800">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}

          {tab === "prompt" && (
            <div className="space-y-4">
              {typeof payload.prompt === "string" && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Prompt envoyé
                  </h3>
                  <pre className="whitespace-pre-wrap rounded-lg bg-amber-50 p-4 text-xs text-gray-800">
                    {payload.prompt}
                  </pre>
                </section>
              )}
              {(typeof payload.response === "string" || typeof payload.content === "string") && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Réponse LLM
                  </h3>
                  <pre className="whitespace-pre-wrap rounded-lg bg-green-50 p-4 text-xs text-gray-800">
                    {String(payload.response ?? payload.content)}
                  </pre>
                  <div className="mt-2 flex gap-4 text-xs text-gray-400">
                    {payload.model != null && <span>Modèle: {String(payload.model)}</span>}
                    {payload.model_version != null && <span>Version: {String(payload.model_version)}</span>}
                    {payload.latency_ms != null && <span>Latence: {String(payload.latency_ms)} ms</span>}
                  </div>
                </section>
              )}
            </div>
          )}

          {tab === "sources" && (
            <RAGSourcesTab payload={payload} />
          )}

          {tab === "rerun" && (
            <RerunPanel
              declarationId={declarationId}
              eventId={event.id}
              originalPrompt={String(payload.prompt ?? "")}
              originalResponse={String(payload.response ?? payload.content ?? "")}
              originalModel={String(payload.model ?? "unknown")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RAGSourcesTab({ payload }: { payload: Record<string, unknown> }) {
  const chunks = (
    (payload.retrieved_chunks ?? payload.chunks ?? payload.sources ?? []) as unknown[]
  ).filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null);

  if (chunks.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Aucune source BOFiP enregistrée pour cet événement.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {chunks.map((chunk, i) => (
        <div key={i} className="rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">
              {String(chunk.title ?? chunk.bofip_id ?? `Chunk ${i + 1}`)}
            </span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              score: {typeof chunk.score === "number" ? chunk.score.toFixed(3) : "n/a"}
            </span>
          </div>
          {chunk.url != null && (
            <a
              href={String(chunk.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-xs text-indigo-500 hover:underline"
            >
              {String(chunk.url)}
            </a>
          )}
          {chunk.text != null && (
            <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">
              {String(chunk.text).slice(0, 500)}
              {String(chunk.text).length > 500 ? "…" : ""}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
