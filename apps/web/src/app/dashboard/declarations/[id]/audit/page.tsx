/**
 * Declaration Audit Trail page — /dashboard/declarations/:id/audit
 *
 * Server component: fetches ReplayBundle from the API, then renders
 * the interactive AuditTimeline (client component).
 *
 * This page is the key MVP differentiator for DGFiP auditability:
 * every AI decision, BOFiP source, and LLM prompt is inspectable here.
 */
import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { AuditTimeline, type ReplayBundle } from "./_components/AuditTimeline";
import { DownloadBundleButton } from "./_components/DownloadBundleButton";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";

async function fetchReplayBundle(
  declarationId: string,
  token: string,
): Promise<ReplayBundle> {
  const res = await fetch(
    `${API_BASE}/v1/declarations/${declarationId}/replay`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // Revalidate every 60 s — audit log is append-only so rarely stale
      next: { revalidate: 60 },
    },
  );

  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);

  return res.json() as Promise<ReplayBundle>;
}

export default async function DeclarationAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: declarationId } = await params;
  const { userId, getToken } = await auth();

  if (!userId) redirect("/sign-in");

  const token = await getToken();
  if (!token) redirect("/sign-in");

  const bundle = await fetchReplayBundle(declarationId, token);

  return (
    <main className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <nav className="mb-1 flex items-center gap-1 text-sm text-gray-500">
            <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
            <span>›</span>
            <a
              href={`/dashboard/declarations/${declarationId}`}
              className="hover:text-gray-700"
            >
              Déclaration
            </a>
            <span>›</span>
            <span className="text-gray-900">Audit trail</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">
            Journal d&apos;audit
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Trace complète de toutes les décisions IA pour cette déclaration CA3.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="rounded-lg bg-gray-50 px-4 py-2 text-xs text-gray-500">
            <div>
              Entité:{" "}
              <span className="font-mono text-gray-800">{declarationId}</span>
            </div>
            <div>
              Généré le{" "}
              {new Date(bundle.generatedAt).toLocaleString("fr-FR")}
            </div>
          </div>
          <DownloadBundleButton declarationId={declarationId} token={token} />
        </div>
      </div>

      {/* Timeline */}
      <AuditTimeline bundle={bundle} declarationId={declarationId} />
    </main>
  );
}
