"use client";

import { useState } from "react";

type Props = {
  declarationId: string;
  eventId: string;
  originalPrompt: string;
  originalResponse: string;
  originalModel: string;
};

type RerunResult = {
  currentModel: string;
  currentResponse: string;
  comparedAt: string;
};

export function RerunPanel({
  declarationId,
  eventId,
  originalPrompt,
  originalResponse,
  originalModel,
}: Props) {
  const [result, setResult] = useState<RerunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runReplay() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/declarations/${declarationId}/replay-llm/${eventId}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult({
        currentModel: data.currentModel,
        currentResponse: data.currentResponse,
        comparedAt: data.comparedAt,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        <strong>Comparaison de modèle</strong> — Rejoue le même prompt avec le
        modèle Claude actuel ({result?.currentModel ?? "claude-sonnet-4-6"})
        pour comparer la réponse originale et la réponse actuelle.
      </div>

      {/* Side-by-side prompt */}
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Prompt (identique)
        </h3>
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
          {originalPrompt || "(aucun prompt enregistré)"}
        </pre>
      </section>

      {/* Trigger button */}
      {!result && (
        <button
          type="button"
          onClick={runReplay}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Interrogation de Claude…
            </>
          ) : (
            "↺ Que dirait Claude aujourd'hui ?"
          )}
        </button>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Erreur : {error}
        </p>
      )}

      {result && (
        <div className="grid grid-cols-2 gap-4">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Réponse originale
              <span className="ml-2 font-normal normal-case text-gray-400">
                ({originalModel})
              </span>
            </h3>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-800">
              {originalResponse}
            </pre>
          </section>

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Réponse actuelle
              <span className="ml-2 font-normal normal-case text-gray-400">
                ({result.currentModel})
              </span>
            </h3>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-indigo-50 p-3 text-xs text-gray-800">
              {result.currentResponse}
            </pre>
          </section>

          <p className="col-span-2 text-xs text-gray-400">
            Comparaison effectuée le{" "}
            {new Date(result.comparedAt).toLocaleString("fr-FR")}
          </p>

          <button
            type="button"
            onClick={() => { setResult(null); setError(null); }}
            className="col-span-2 text-xs text-indigo-600 hover:underline"
          >
            Relancer une comparaison
          </button>
        </div>
      )}
    </div>
  );
}
