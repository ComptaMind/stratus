"use client";

import { useCallback, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

type ImportStatus = "idle" | "uploading" | "parsing" | "parsed" | "failed";

interface ImportResult {
  import_id: string;
  upload_url: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function NewFecImportPage() {
  const { id: fiscalClientId } = useParams<{ id: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [periodType, setPeriodType] = useState<"mensuelle" | "trimestrielle">("mensuelle");

  const [status, setStatus] = useState<ImportStatus>("idle");
  const [importId, setImportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) validateAndSetFile(dropped);
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) validateAndSetFile(f);
  };

  function validateAndSetFile(f: File) {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (![".txt", ".csv"].includes(ext)) {
      setError("Only .txt and .csv files are accepted.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setError("File must be under 50 MB.");
      return;
    }
    setFile(f);
    setError(null);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !periodStart || !periodEnd) return;

    setStatus("uploading");
    setError(null);

    try {
      const token = await getToken();

      // 1. Upload file + metadata → create FECImport
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fiscalClientId", fiscalClientId);
      formData.append("periodStart", periodStart);
      formData.append("periodEnd", periodEnd);
      formData.append("periodType", periodType);

      const createRes = await fetch(`${API_URL}/v1/fec-imports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body.message ?? "Upload failed");
      }

      const createData: ImportResult = await createRes.json();
      setImportId(createData.import_id);

      // 2. Trigger async parse
      setStatus("parsing");
      const parseRes = await fetch(
        `${API_URL}/v1/fec-imports/${createData.import_id}/parse`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!parseRes.ok) {
        const body = await parseRes.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to trigger parse");
      }

      // 3. Poll import status
      pollStatus(createData.import_id, token!);
    } catch (err) {
      setStatus("failed");
      setError((err as Error).message);
    }
  }

  function pollStatus(id: string, token: string) {
    let count = 0;
    const interval = setInterval(async () => {
      count++;
      setPollCount(count);

      try {
        const res = await fetch(`${API_URL}/v1/fec-imports/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const data = await res.json();

        if (data.status === "parsed") {
          clearInterval(interval);
          setStatus("parsed");
        } else if (data.status === "failed") {
          clearInterval(interval);
          setStatus("failed");
          setError(data.errorMessage ?? "Parsing failed");
        } else if (count >= 30) {
          // 30 × 2s = 60s timeout
          clearInterval(interval);
          setStatus("failed");
          setError("Parsing timed out after 60 seconds");
        }
      } catch {
        // Network error — keep polling
      }
    }, 2000);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Import FEC file</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a FEC file (.txt or .csv, max 50 MB) for this client.
        </p>
      </div>

      {status === "parsed" && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">
            FEC parsed successfully.{" "}
            <button
              onClick={() =>
                router.push(
                  `/dashboard/fiscal-clients/${fiscalClientId}/imports/${importId}`
                )
              }
              className="underline"
            >
              View import
            </button>
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={[
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-8 py-12 cursor-pointer transition-colors",
            dragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-gray-50 hover:border-gray-400",
          ].join(" ")}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.csv"
            className="sr-only"
            onChange={handleFileChange}
          />
          {file ? (
            <div className="text-center">
              <p className="text-sm font-medium text-gray-900">{file.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm text-gray-600">
                Drag and drop your FEC file here, or{" "}
                <span className="text-blue-600 underline">browse</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">.txt or .csv — max 50 MB</p>
            </div>
          )}
        </div>

        {/* Period fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Period start
            </label>
            <input
              type="date"
              required
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Period end
            </label>
            <input
              type="date"
              required
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Period type */}
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-2">
            Period type
          </span>
          <div className="flex gap-6">
            {(["mensuelle", "trimestrielle"] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="periodType"
                  value={t}
                  checked={periodType === t}
                  onChange={() => setPeriodType(t)}
                  className="h-4 w-4 text-blue-600"
                />
                <span className="text-sm text-gray-700 capitalize">{t}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={!file || !periodStart || !periodEnd || status === "uploading" || status === "parsing"}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "uploading"
              ? "Uploading…"
              : status === "parsing"
              ? `Parsing… (${pollCount * 2}s)`
              : "Import FEC"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
