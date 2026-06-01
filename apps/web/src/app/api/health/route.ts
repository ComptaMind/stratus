import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "stratus-web",
      version: process.env.npm_package_version ?? "0.0.0",
      uptime_s: Math.floor(process.uptime()),
    },
    { status: 200 },
  );
}
