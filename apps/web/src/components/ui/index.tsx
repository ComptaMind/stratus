"use client";
/**
 * Minimal design-system primitives.
 * Built on Tailwind v4 CSS variables — no shadcn/ui CLI required.
 */
import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, useState } from "react";

// ── Badge ─────────────────────────────────────────────────────────────────────

type BadgeVariant = "default" | "success" | "warning" | "danger" | "outline" | "purple";

const BADGE_STYLES: Record<BadgeVariant, string> = {
  default:  "bg-[#232635] text-[#8b90a8] border border-[#2d3148]",
  success:  "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40",
  warning:  "bg-amber-950/60  text-amber-400  border border-amber-800/40",
  danger:   "bg-red-950/60    text-red-400    border border-red-800/40",
  outline:  "bg-transparent   text-[#8b90a8]  border border-[#2d3148]",
  purple:   "bg-indigo-950/60 text-indigo-400 border border-indigo-800/40",
};

export function Badge({ variant = "default", className, children }: { variant?: BadgeVariant; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", BADGE_STYLES[variant], className)}>
      {children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "ghost" | "danger";

const BTN: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 hover:bg-indigo-500 text-white",
  ghost:   "bg-transparent hover:bg-[#232635] text-[#8b90a8] hover:text-[#e8eaf0] border border-[#2d3148]",
  danger:  "bg-red-600 hover:bg-red-500 text-white",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }>(
  ({ variant = "primary", size = "md", className, children, ...props }, ref) => {
    const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          BTN[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("bg-[#1a1d27] border border-[#2d3148] rounded-xl", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4 border-b border-[#2d3148]", className)}>{children}</div>;
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

// ── Input ─────────────────────────────────────────────────────────────────────

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string }>(
  ({ label, className, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-[#8b90a8]">{label}</label>}
      <input
        ref={ref}
        className={cn(
          "bg-[#232635] border border-[#2d3148] rounded-lg text-[#e8eaf0] placeholder:text-[#4b5168]",
          "px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors w-full",
          className,
        )}
        {...props}
      />
    </div>
  ),
);
Input.displayName = "Input";

// ── Tabs ──────────────────────────────────────────────────────────────────────

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string; icon?: ReactNode }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 border-b border-[#2d3148]">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
            active === t.id
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-[#8b90a8] hover:text-[#e8eaf0]",
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────

export function Select({ label, options, ...props }: InputHTMLAttributes<HTMLSelectElement> & { label?: string; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-[#8b90a8]">{label}</label>}
      <select
        className="bg-[#232635] border border-[#2d3148] rounded-lg text-[#e8eaf0] px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-colors"
        {...props}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-[#1a1d27] border border-[#2d3148] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3148]">
          <h2 className="font-semibold text-[#e8eaf0]">{title}</h2>
          <button type="button" onClick={onClose} className="text-[#8b90a8] hover:text-[#e8eaf0] transition-colors">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="animate-spin text-indigo-400" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      {icon && <div className="text-[#4b5168] text-4xl">{icon}</div>}
      <p className="font-medium text-[#e8eaf0]">{title}</p>
      {description && <p className="text-sm text-[#8b90a8] max-w-xs">{description}</p>}
      {action}
    </div>
  );
}
