import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const { email, name, firmName, country } = body as Record<string, string>;

  if (!email || !name) {
    return NextResponse.json({ message: "email and name are required" }, { status: 422 });
  }

  try {
    const upstream = await fetch(`${API_BASE}/v1/beta-signups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, firmName, country }),
    });

    const data = await upstream.json().catch(() => ({})) as Record<string, unknown>;

    if (!upstream.ok) {
      const status = upstream.status === 409 ? 409 : 502;
      return NextResponse.json(data, { status });
    }

    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ message: "Service unavailable" }, { status: 503 });
  }
}
