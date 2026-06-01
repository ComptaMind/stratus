import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import type { FiscalClient } from "@/lib/types";
import { ChatClient } from "./_components/ChatClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = (await getToken()) ?? "";

  let client: FiscalClient | null = null;
  try {
    const res = await fetch(`${API}/fiscal-clients/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) client = await res.json();
  } catch {
    // fallback: let client be null
  }

  if (!client && !id.startsWith("demo-")) notFound();

  const demoClient = !client
    ? { id, org_id: "demo-org", name: "Demo Client", siret: undefined, period_type: "monthly" as const, created_at: "", updated_at: "" }
    : client;

  return <ChatClient client={demoClient} token={token} demoMode={!client} />;
}
