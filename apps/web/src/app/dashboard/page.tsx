import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { FiscalClient } from "@/lib/types";
import { DashboardClient } from "./_components/DashboardClient";

async function fetchClients(token: string): Promise<FiscalClient[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/fiscal-clients`,
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 30 },
      },
    );
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = (await getToken()) ?? "";
  const clients = await fetchClients(token);

  return <DashboardClient initialClients={clients} />;
}
