"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Props {
  declarationId: string;
  token: string;
}

export function DownloadBundleButton({ declarationId, token }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/v1/declarations/${declarationId}/replay-bundle`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `audit_bundle_${declarationId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50 disabled:opacity-50"
        style={{ borderColor: "#d1d5db", color: "#374151" }}
        data-testid="export-bundle-btn"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Download size={14} />
        )}
        {loading ? "Generating…" : "Download audit bundle (.zip)"}
      </button>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
