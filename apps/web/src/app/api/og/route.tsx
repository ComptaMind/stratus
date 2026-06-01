import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page");

  const subtitle =
    page === "audit"
      ? "Replay every AI decision. eIDAS-ready. EU AI Act compliant."
      : page === "pricing"
      ? "Indé €39 · Pro €149 · Cabinet €790 · Enterprise custom"
      : "Auditable · Multi-LLM · EDI-TVA native · Private beta Sept 2026";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0E1116",
          position: "relative",
        }}
      >
        {/* Glow */}
        <div
          style={{
            position: "absolute",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,90,78,0.18) 0%, transparent 70%)",
            top: -100,
            left: "50%",
            transform: "translateX(-50%)",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              background: "#FF5A4E",
              color: "#fff",
              width: 48,
              height: 48,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 800,
            }}
          >
            S
          </div>
          <span
            style={{
              fontSize: 32,
              fontWeight: 800,
              color: "#F0F2F5",
              letterSpacing: "-0.5px",
            }}
          >
            Stratus
          </span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 58,
            fontWeight: 800,
            color: "#F0F2F5",
            textAlign: "center",
            margin: "0 0 20px",
            letterSpacing: "-2px",
            lineHeight: 1.05,
            maxWidth: 900,
          }}
        >
          AI Fiscal Agent<br />
          <span style={{ color: "#FF5A4E" }}>for French VAT</span>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: 22,
            color: "#8A8FA0",
            textAlign: "center",
            margin: 0,
            maxWidth: 700,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </p>

        {/* Bottom badge */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255,90,78,0.1)",
            border: "1px solid rgba(255,90,78,0.3)",
            borderRadius: 99,
            padding: "8px 20px",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              background: "#FF5A4E",
              borderRadius: "50%",
            }}
          />
          <span style={{ fontSize: 16, color: "#FF5A4E", fontWeight: 700 }}>
            Private beta · September 2026
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
