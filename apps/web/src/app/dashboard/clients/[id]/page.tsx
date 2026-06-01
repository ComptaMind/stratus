import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import type { FiscalClient, FECImport, CA3Declaration } from "@/lib/types";
import { ClientDetailClient } from "./_components/ClientDetailClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function get<T>(path: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = (await getToken()) ?? "";
  const [client, imports, declarations] = await Promise.all([
    get<FiscalClient>(`/fiscal-clients/${id}`, token),
    get<FECImport[]>(`/v1/fec-imports?fiscal_client_id=${id}`, token),
    get<CA3Declaration[]>(`/v1/declarations?fiscal_client_id=${id}`, token),
  ]);

  if (!client && !id.startsWith("demo-")) notFound();

  return (
    <ClientDetailClient
      client={client ?? { id, org_id: "demo-org", name: "", siret: undefined, period_type: "monthly", created_at: "", updated_at: "" }}
      imports={imports ?? []}
      declarations={declarations ?? []}
      token={token}
      demoMode={!client}
    />
  );
}
