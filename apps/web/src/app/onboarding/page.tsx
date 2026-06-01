"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const VAT_REGIMES = ["réel normal", "réel simplifié", "franchise"] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [form, setForm] = useState({
    orgName: "",
    country: "FR",
    vatRegimeDefault: "réel normal",
    siret: "",
    siren: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/onboarding`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `API error ${res.status}`);
      }

      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      // If the API is not running locally, let the user skip to dashboard anyway
      if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("Failed to fetch") || msg.includes("load failed")) {
        router.push("/dashboard");
        return;
      }
      setError(msg + " — l'API n'est pas démarrée. Cliquez \"Passer\" pour continuer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold">Set up your workspace</h1>
        <p className="mt-1 text-gray-500">
          Tell us about your accounting firm to get started.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Firm name *
            </label>
            <input
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none"
              value={form.orgName}
              onChange={(e) => setForm({ ...form, orgName: e.target.value })}
              placeholder="Cabinet Dupont & Associés"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Default VAT regime
            </label>
            <select
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none"
              value={form.vatRegimeDefault}
              onChange={(e) =>
                setForm({ ...form, vatRegimeDefault: e.target.value })
              }
            >
              {VAT_REGIMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                SIRET
              </label>
              <input
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                value={form.siret}
                onChange={(e) => setForm({ ...form, siret: e.target.value })}
                placeholder="12345678900012"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                SIREN
              </label>
              <input
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm"
                value={form.siren}
                onChange={(e) => setForm({ ...form, siren: e.target.value })}
                placeholder="123456789"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? "Creating workspace…" : "Create workspace"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Passer (mode démo sans API) →
          </button>
        </form>
      </div>
    </div>
  );
}
