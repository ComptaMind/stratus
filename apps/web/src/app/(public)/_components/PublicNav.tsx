"use client";

import Link from "next/link";
import { useState } from "react";

export function PublicNav() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(14,17,22,0.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid #2A2F3D",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "0 24px",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}
        >
          <span
            style={{
              background: "#FF5A4E",
              color: "#fff",
              width: 28,
              height: 28,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            S
          </span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#F0F2F5", letterSpacing: "-0.3px" }}>
            Stratus
          </span>
        </Link>

        {/* Desktop links */}
        <div
          style={{ display: "flex", alignItems: "center", gap: 32 }}
          className="nav-desktop"
        >
          <Link href="/audit-by-design" style={{ color: "#8A8FA0", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            Audit by Design
          </Link>
          <Link href="/pricing" style={{ color: "#8A8FA0", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            Pricing
          </Link>
          <Link href="/about" style={{ color: "#8A8FA0", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            About
          </Link>
          <Link href="/sign-in" style={{ color: "#8A8FA0", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            Sign in
          </Link>
          <Link
            href="/#beta"
            style={{
              background: "#FF5A4E",
              color: "#fff",
              padding: "8px 18px",
              borderRadius: 8,
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Join beta
          </Link>
        </div>
      </div>
    </nav>
  );
}
