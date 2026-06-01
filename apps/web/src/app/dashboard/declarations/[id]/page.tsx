import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import type { CA3Declaration } from "@/lib/types";
import { DeclarationDetailClient } from "./_components/DeclarationDetailClient";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default async function DeclarationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const token = (await getToken()) ?? "";

  let declaration: CA3Declaration | null = null;
  try {
    const res = await fetch(`${API}/v1/declarations/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 30 },
    });
    if (res.ok) declaration = await res.json();
  } catch {
    // fallback
  }

  if (!declaration) notFound();

  return <DeclarationDetailClient declaration={declaration} token={token} />;
}
