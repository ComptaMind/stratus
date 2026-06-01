import type { Metadata } from "next";
import Link from "next/link";
import { PublicNav } from "./_components/PublicNav";

export const metadata: Metadata = {
  title: {
    default: "Stratus — AI Fiscal Agent for French VAT",
    template: "%s | Stratus",
  },
  description:
    "The auditable AI fiscal agent for French VAT compliance. FEC import · CA3 computation · EDI-TVA export · full audit trail. Private beta Sept 2026.",
  openGraph: {
    type: "website",
    siteName: "Stratus",
    title: "Stratus — AI Fiscal Agent for French VAT",
    description:
      "The auditable AI fiscal agent for French VAT compliance. Multi-LLM, eIDAS-ready audit trail, EDI-TVA generation.",
    images: [
      {
        url: "/api/og",
        width: 1200,
        height: 630,
        alt: "Stratus — AI Fiscal Agent for French VAT",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stratus — AI Fiscal Agent for French VAT",
    description:
      "Auditable AI fiscal agent for French VAT. Multi-LLM, full audit trail, EDI-TVA XML generation.",
    images: ["/api/og"],
  },
  robots: { index: true, follow: true },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#0E1116", minHeight: "100vh", color: "#F0F2F5" }}>
      <PublicNav />
      {children}
      <footer
        style={{
          borderTop: "1px solid #2A2F3D",
          padding: "40px 0",
          marginTop: 80,
          textAlign: "center",
          color: "#6B7280",
          fontSize: 13,
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
            <Link href="/audit-by-design" style={{ color: "#8A8FA0", textDecoration: "none" }}>Audit by Design</Link>
            <Link href="/pricing" style={{ color: "#8A8FA0", textDecoration: "none" }}>Pricing</Link>
            <Link href="/about" style={{ color: "#8A8FA0", textDecoration: "none" }}>About</Link>
            <Link href="/sign-in" style={{ color: "#8A8FA0", textDecoration: "none" }}>Sign in</Link>
          </div>
          <p style={{ margin: 0 }}>© 2026 Stratus. Built by Enderix Finance. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
