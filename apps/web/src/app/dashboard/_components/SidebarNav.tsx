"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, FileText, MessageSquare, Settings } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/clients", label: "Clients", icon: Users, exact: false },
  { href: "/dashboard/declarations", label: "Declarations", icon: FileText, exact: false },
];

export function SidebarNav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside
      className="flex w-56 shrink-0 flex-col border-r"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-5 border-b" style={{ borderColor: "var(--border)" }}>
        <span className="font-bold text-sm tracking-tight" style={{ color: "var(--fg)" }}>
          ⚡ Stratus
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={
                active
                  ? { background: "rgba(99,102,241,0.15)", color: "var(--accent)" }
                  : { color: "var(--fg-muted)" }
              }
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="border-t px-4 py-3"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-xs truncate" style={{ color: "var(--fg-muted)" }}>{email}</p>
      </div>
    </aside>
  );
}
