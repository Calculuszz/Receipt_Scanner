"use client";
// Top bar shared by the main pages: title, notification bell, theme, log out,
// and (for admins) tabs between My receipts, Review, Club, Reports and Members.
// It also keeps the unread count live with Supabase Realtime and pops a toast for new notifications.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { loadMe, type Me } from "@/lib/admin";
import type { AppNotification } from "@/lib/types";
import { ICONS } from "@/lib/ui";
import { Icon, RoundButton, Spinner, ThemeToggle, Toast } from "@/components/ui";

/** bump goes up on every live notification, so pages can reload their data. */
type Shell = { me: Me; pending: number; bump: number; refreshCounts: () => void };
const ShellContext = createContext<Shell | null>(null);

/** The signed-in person and their role. Only usable inside <AppShell>. */
export function useShell(): Shell {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>");
  return ctx;
}

type Tab = { href: string; label: string; icon: string; show: (me: Me) => boolean; badge?: "pending" };
const TABS: Tab[] = [
  { href: "/", label: "My receipts", icon: ICONS.home, show: () => true },
  { href: "/review", label: "Review", icon: ICONS.inbox, show: (me) => me.admin, badge: "pending" },
  { href: "/club", label: "Club", icon: ICONS.users, show: (me) => me.admin },
  { href: "/reports", label: "Reports", icon: ICONS.chart, show: (me) => me.admin },
  { href: "/members", label: "Members", icon: ICONS.shield, show: (me) => me.admin },
];

export default function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [bump, setBump] = useState(0);

  const refreshCounts = useCallback(async () => {
    const who = await loadMe(supabase);
    if (!who) { router.replace("/login"); return; }
    setMe(who);
    const [n, p] = await Promise.all([
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", who.id).is("read_at", null),
      who.admin
        ? supabase.from("receipts").select("id", { count: "exact", head: true }).eq("status", "pending")
        : Promise.resolve({ count: 0 }),
    ]);
    setUnread(n.count ?? 0);
    setPending(p.count ?? 0);
  }, [router]);

  useEffect(() => {
    // Loads data from Supabase (external system) on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCounts();
  }, [refreshCounts]);

  // Live: a new notification bumps the badge and shows a toast right away.
  const myId = me?.id;
  useEffect(() => {
    if (!myId) return;
    const channel = supabase
      // Unique topic per mount: reusing a name while the old channel is closing can drop the new one.
      .channel(`notifications-${myId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${myId}` },
        (payload) => { setToast(payload.new as AppNotification); setBump((b) => b + 1); void refreshCounts(); })
      .subscribe();
    // Also catch up when the tab comes back to the foreground.
    const onFocus = () => void refreshCounts();
    window.addEventListener("focus", onFocus);
    return () => { void supabase.removeChannel(channel); window.removeEventListener("focus", onFocus); };
  }, [myId, refreshCounts]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted" role="status">
        <Spinner size={28} /><span className="sr-only">Loading</span>
      </div>
    );
  }

  const tabs = TABS.filter((t) => t.show(me));
  const openToast = () => {
    if (!toast) return;
    const t = toast; setToast(null);
    router.push(t.receipt_id ? `/receipts/${t.receipt_id}` : "/notifications");
  };

  return (
    <ShellContext.Provider value={{ me, pending, bump, refreshCounts }}>
      {toast && (
        <Toast key={toast.id} text={toast.title} ms={5000} actionLabel="Open" onAction={openToast} onDone={() => setToast(null)} />
      )}
      <div className="mx-auto w-full max-w-md px-5 pt-[max(24px,env(safe-area-inset-top))] md:max-w-6xl md:px-10 md:pt-10 lg:px-12">
        <header className="flex items-center justify-between gap-3">
          <h1 className="truncate text-[30px] font-semibold tracking-[-0.03em] md:text-[36px]">{title}</h1>
          <div className="flex shrink-0 gap-2">
            <Link href="/scan"
              className="tap hidden h-11 items-center gap-2 rounded-full bg-fg pl-4 pr-5 text-[15px] font-semibold text-bg md:flex">
              <Icon d={ICONS.camera} size={20} stroke={1.9} /> Scan receipt
            </Link>
            <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              className="tap relative flex h-11 w-11 items-center justify-center rounded-full bg-surface">
              <Icon d={ICONS.bell} />
              {unread > 0 && (
                <span className="anim-pop absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <ThemeToggle />
            <RoundButton icon={ICONS.logout} aria-label="Log out" onClick={logout} />
          </div>
        </header>

        {/* Role tabs: underlined text tabs, so they don't look like the range pills below them */}
        {tabs.length > 1 && (
          <nav aria-label="Sections" className="no-scrollbar -mx-5 mt-3 overflow-x-auto border-b border-line px-5 md:mx-0 md:px-0">
            <ul className="flex gap-5">
              {tabs.map((t) => {
                const on = t.href === "/" ? path === "/" : path.startsWith(t.href);
                const count = t.badge === "pending" ? pending : 0;
                return (
                  <li key={t.href}>
                    <Link href={t.href} aria-current={on ? "page" : undefined}
                      className={`relative flex h-11 items-center gap-1.5 whitespace-nowrap text-[15px] font-medium transition-colors ${on ? "text-fg" : "text-muted"}`}>
                      <Icon d={t.icon} size={17} stroke={1.9} />
                      {t.label}
                      {count > 0 && (
                        <span className="rounded-full bg-fg px-1.5 text-[11px] font-semibold leading-[18px] text-bg">{count}</span>
                      )}
                      <span className={`absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-fg transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
      {children}
    </ShellContext.Provider>
  );
}
