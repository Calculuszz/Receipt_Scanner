"use client";
// Small shared UI pieces: icons, round icon buttons, theme toggle, toast, spinner.
import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import { ICONS } from "@/lib/ui";

export function Icon({ d, size = 20, stroke = 1.8, className }: { d: string; size?: number; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** 44×44 round button with an icon (needs an aria-label). */
export function RoundButton({ icon, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string }) {
  return (
    <button type="button" {...props}
      className={`tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-fg ${className}`}>
      <Icon d={icon} />
    </button>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    // Read the theme the head script already applied (external DOM state).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("rs-theme", next); } catch { /* not saved; still switches */ }
    setTheme(next);
  }

  return (
    <RoundButton
      icon={theme === "dark" ? ICONS.sun : ICONS.moon}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    />
  );
}

/** Top toast that slides down and hides itself. */
export function Toast({ text, actionLabel, onAction, onDone, ms = 2600 }: {
  text: string; actionLabel?: string; onAction?: () => void; onDone: () => void; ms?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [onDone, ms]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-[max(16px,env(safe-area-inset-top))]">
      <div role="status" aria-live="polite"
        className="anim-toast pointer-events-auto flex min-h-14 w-full max-w-md items-center gap-3 rounded-[18px] bg-fg py-1 pl-4 pr-2 text-bg shadow-[0_14px_34px_rgba(0,0,0,0.25)]">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-ink">
          <Icon d={ICONS.check} size={14} stroke={3} />
        </span>
        <span className="flex-1 text-[15px] font-medium">{text}</span>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="tap h-10 rounded-xl px-3.5 text-[15px] font-semibold text-[#22D27F] dark:text-[#057040]">
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
