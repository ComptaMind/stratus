"use client";

import { useState } from "react";
import { EventCard, type AuditEvent } from "./EventCard";
import { EventModal } from "./EventModal";

type LLMCall = {
  eventId: string;
  model: string;
  modelVersion: string;
  latencyMs?: number;
};

type RAGRetrieval = {
  eventId: string;
  query: string;
  chunks: { bofipId?: string }[];
};

type FiscalCodeState = {
  bofipVersionDate: string;
  relevantSections: string[];
};

export type ReplayBundle = {
  entityType: string;
  entityId: string;
  orgId: string;
  events: AuditEvent[];
  llmCalls: LLMCall[];
  ragRetrievals: RAGRetrieval[];
  fiscalCodeState: FiscalCodeState;
  generatedAt: string;
};

type Props = {
  bundle: ReplayBundle;
  declarationId: string;
};

export function AuditTimeline({ bundle, declarationId }: Props) {
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const { events, llmCalls, ragRetrievals, fiscalCodeState } = bundle;

  function handleDownload() {
    const a = document.createElement("a");
    a.href = `/api/v1/declarations/${declarationId}/replay-bundle`;
    a.download = `stratus-replay-${declarationId}.zip`;
    a.click();
  }

  return (
    <div className="flex gap-6">
      {/* Left: timeline list */}
      <div className="flex w-full max-w-xl flex-col gap-2">
        {/* Stats bar */}
        <div className="mb-4 flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <Stat label="Événements" value={events.length} />
          <Stat label="Appels LLM" value={llmCalls.length} color="text-purple-700" />
          <Stat label="Récupérations RAG" value={ragRetrievals.length} color="text-emerald-700" />
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">Version BOFiP</span>
            <span className="font-medium text-gray-900">
              {fiscalCodeState.bofipVersionDate}
            </span>
          </div>
        </div>

        {/* Event list */}
        <div className="relative space-y-2">
          {/* Vertical line */}
          <div className="absolute left-[22px] top-4 bottom-4 w-px bg-gray-200" />

          {events.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSelected={selectedEvent?.id === event.id}
              onClick={() =>
                setSelectedEvent(
                  selectedEvent?.id === event.id ? null : event,
                )
              }
            />
          ))}
        </div>
      </div>

      {/* Right: summary panel */}
      <div className="flex-1 space-y-4">
        {/* BOFiP sections */}
        {fiscalCodeState.relevantSections.length > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-emerald-900">
              Sections BOFiP référencées
            </h3>
            <ul className="space-y-1">
              {fiscalCodeState.relevantSections.map((s) => (
                <li key={s} className="text-xs text-emerald-800">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* LLM calls summary */}
        {llmCalls.length > 0 && (
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-purple-900">
              Appels LLM
            </h3>
            <ul className="space-y-1">
              {llmCalls.map((c) => (
                <li
                  key={c.eventId}
                  className="cursor-pointer text-xs text-purple-800 hover:underline"
                  onClick={() => {
                    const ev = events.find((e) => e.id === c.eventId);
                    if (ev) setSelectedEvent(ev);
                  }}
                >
                  {c.model} {c.latencyMs ? `(${c.latencyMs} ms)` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Export button */}
        <button
          type="button"
          onClick={handleDownload}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-white px-4 py-3 text-sm font-medium text-indigo-700 shadow-sm hover:bg-indigo-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Exporter le bundle de replay (.zip)
        </button>

        <p className="text-xs text-gray-400">
          Contient: audit_log.jsonl, prompts/, sources/ BOFiP, XML EDI-TVA.
          Utilisable comme preuve auprès d'un contrôleur DGFiP.
        </p>
      </div>

      {/* Modal */}
      {selectedEvent && (
        <EventModal
          event={selectedEvent}
          declarationId={declarationId}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color = "text-gray-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{value}</span>
    </div>
  );
}
