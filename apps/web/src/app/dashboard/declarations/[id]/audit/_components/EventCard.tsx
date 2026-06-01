"use client";

import { cn } from "@/lib/utils";

export type AuditEvent = {
  id: string;
  createdAt: string;
  actorType: "user" | "agent" | "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
};

type Props = {
  event: AuditEvent;
  isSelected: boolean;
  onClick: () => void;
};

const ACTOR_STYLES: Record<string, string> = {
  user:   "bg-blue-100 text-blue-800",
  agent:  "bg-purple-100 text-purple-800",
  system: "bg-gray-100 text-gray-700",
};

const ACTION_ICONS: Record<string, string> = {
  "fec.upload":              "📂",
  "entry.classified":        "🏷️",
  "declaration.computed":    "🧮",
  "declaration.filed":       "📤",
  "edi_tva.generated":       "📄",
  "rag.retrieval":           "🔍",
  "bofip.retrieval":         "📚",
  "agent.transition":        "🔀",
  "handle_question":         "💬",
  "ask_user_clarification":  "❓",
  "llm.call":                "🤖",
};

function actionIcon(action: string): string {
  return ACTION_ICONS[action] ?? "•";
}

function hasLLMData(payload: Record<string, unknown>): boolean {
  return typeof payload.prompt === "string" || typeof payload.response === "string";
}

function hasRAGData(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.retrieved_chunks) || Array.isArray(payload.chunks);
}

export function EventCard({ event, isSelected, onClick }: Props) {
  const ts = new Date(event.createdAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-all",
        "hover:border-indigo-400 hover:shadow-sm",
        isSelected
          ? "border-indigo-500 bg-indigo-50 shadow-sm"
          : "border-gray-200 bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Timeline dot */}
        <div className="mt-1 flex-shrink-0 text-lg leading-none">
          {actionIcon(event.action)}
        </div>

        <div className="min-w-0 flex-1">
          {/* Top row: action + actor badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium text-gray-900">
              {event.action}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                ACTOR_STYLES[event.actorType] ?? ACTOR_STYLES.system,
              )}
            >
              {event.actorType} · {event.actorId}
            </span>
          </div>

          {/* Timestamp */}
          <p className="mt-0.5 text-xs text-gray-500">
            {ts.toLocaleString("fr-FR", {
              day: "2-digit", month: "2-digit", year: "numeric",
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
          </p>

          {/* Artifact badges */}
          <div className="mt-2 flex gap-2">
            {hasLLMData(event.payload) && (
              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-700 ring-1 ring-purple-200">
                LLM prompt
              </span>
            )}
            {hasRAGData(event.payload) && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200">
                RAG sources
              </span>
            )}
          </div>

          {/* Key payload preview */}
          {typeof event.payload.action !== "undefined" ||
           typeof event.payload.phase !== "undefined" ? (
            <p className="mt-1 truncate text-xs text-gray-400">
              {typeof event.payload.phase === "string" && `phase: ${event.payload.phase}`}
              {typeof event.payload.from_state === "string" &&
                ` ${event.payload.from_state} → ${event.payload.to_state}`}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  );
}
