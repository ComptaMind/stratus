"use client";

import { useState } from "react";

type State = "idle" | "loading" | "success" | "error";

export function BetaSignupForm() {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", name: "", firmName: "", country: "FR" });

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [k]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({})) as { message?: string };
      if (!res.ok) {
        const msg = data.message ?? `Error ${res.status}`;
        throw new Error(Array.isArray(msg) ? msg.join(", ") : msg);
      }
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div
        style={{
          background: "rgba(255,90,78,0.08)",
          border: "1px solid rgba(255,90,78,0.4)",
          borderRadius: 12,
          padding: "32px 40px",
          textAlign: "center",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
        <h3 style={{ fontSize: 20, fontWeight: 700, color: "#F0F2F5", margin: "0 0 8px" }}>
          You&apos;re in!
        </h3>
        <p style={{ color: "#8A8FA0", margin: 0, lineHeight: 1.6 }}>
          We sent a confirmation to <strong style={{ color: "#F0F2F5" }}>{form.email}</strong>.
          We&apos;ll reach out personally before the September 2026 launch.
        </p>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    background: "#171B22",
    border: "1px solid #2A2F3D",
    borderRadius: 8,
    color: "#F0F2F5",
    padding: "12px 14px",
    fontSize: 14,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8A8FA0", marginBottom: 6, fontWeight: 500 }}>
              Full name *
            </label>
            <input
              required
              value={form.name}
              onChange={set("name")}
              placeholder="Anne-Carla Kamgang"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8A8FA0", marginBottom: 6, fontWeight: 500 }}>
              Work email *
            </label>
            <input
              required
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="you@cabinet.fr"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8A8FA0", marginBottom: 6, fontWeight: 500 }}>
              Firm / company name
            </label>
            <input
              value={form.firmName}
              onChange={set("firmName")}
              placeholder="Cabinet Dupont & Associés"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8A8FA0", marginBottom: 6, fontWeight: 500 }}>
              Country
            </label>
            <select value={form.country} onChange={set("country")} style={{ ...inputStyle, cursor: "pointer" }}>
              <option value="FR">🇫🇷 France</option>
              <option value="BE">🇧🇪 Belgium</option>
              <option value="LU">🇱🇺 Luxembourg</option>
              <option value="CH">🇨🇭 Switzerland</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>

        {state === "error" && (
          <p style={{ color: "#FF5A4E", fontSize: 13, margin: 0 }}>
            {error === "Email already registered for beta"
              ? "This email is already on the list! Check your inbox."
              : error}
          </p>
        )}

        <button
          type="submit"
          disabled={state === "loading"}
          style={{
            background: "#FF5A4E",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "14px 24px",
            fontSize: 15,
            fontWeight: 700,
            cursor: state === "loading" ? "not-allowed" : "pointer",
            opacity: state === "loading" ? 0.7 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {state === "loading" ? "Registering…" : "Join the private beta →"}
        </button>

        <p style={{ fontSize: 12, color: "#6B7280", textAlign: "center", margin: 0 }}>
          Pre-beta users get <strong style={{ color: "#F0F2F5" }}>6 months free</strong> at their plan tier. No credit card required.
        </p>
      </div>
    </form>
  );
}
