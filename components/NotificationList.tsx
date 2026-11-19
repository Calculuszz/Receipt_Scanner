"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import type { AppNotification } from "@/lib/types";
import { ICONS } from "@/lib/ui";
import { Icon, Spinner } from "@/components/ui";
import { useShell } from "@/components/AppShell";

const KIND: Record<string, { icon: string; color: string }> = {
  submitted: { icon: ICONS.inbox, color: "#F5A524" },
  resubmitted: { icon: ICONS.inbox, color: "#F5A524" },
  rejected: { icon: ICONS.warn, color: "var(--danger)" },
  approved: { icon: ICONS.check, color: "#0EB6F2" },
  paid: { icon: ICONS.check, color: "var(--ok)" },
  over_budget: { icon: ICONS.flag, color: "var(--danger)" },
};

function ago(ts: string) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function NotificationList() {
  const router = useRouter();
  const { me, refreshCounts, bump } = useShell();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("notifications").select("*")
      .eq("user_id", me.id).order("created_at", { ascending: false }).limit(100);
    if (error) setError("We couldn't load your notifications.");
    else { setError(""); setItems(data as AppNotification[]); }
  }, [me.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(); // also reruns on each live notification (bump), so new ones appear without a refresh
  }, [load, bump]);

  async function open(n: AppNotification) {
    if (!n.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
      refreshCounts();
    }
    router.push(n.receipt_id && n.kind !== "over_budget" ? `/receipts/${n.receipt_id}` : n.kind === "over_budget" ? "/reports" : "/");
  }

  async function readAll() {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me.id).is("read_at", null);
    await load();
    refreshCounts();
  }

  const unread = items?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-16 pt-5 md:max-w-2xl md:px-10">
      {items === null && !error ? (
        <div className="flex justify-center py-24 text-muted" role="status"><Spinner size={28} /><span className="sr-only">Loading</span></div>
      ) : error ? (
        <p className="rounded-[20px] bg-surface p-5 text-[15px]">{error}</p>
      ) : items!.length === 0 ? (
        <div className="rounded-[20px] bg-surface p-6 text-center">
          <p className="text-[15px] font-medium">No notifications yet</p>
          <p className="mt-1 text-sm text-muted">You&apos;ll hear here when a receipt is approved, sent back or paid.</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-[13px] text-muted">{unread ? `${unread} unread` : "All read"}</p>
            {unread > 0 && (
              <button type="button" onClick={() => void readAll()} className="tap h-9 rounded-full bg-surface px-3.5 text-[13px] font-medium">Mark all read</button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {items!.map((n, i) => {
              const k = KIND[n.kind] ?? KIND.submitted;
              const [first, ...rest] = (n.body ?? "").split("\n");
              return (
                <li key={n.id} className="anim-rise" style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                  <button type="button" onClick={() => void open(n)}
                    className={`tap press flex w-full items-start gap-3 rounded-[20px] p-3.5 text-left ${n.read_at ? "bg-surface/60" : "bg-surface"}`}>
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: `color-mix(in srgb, ${k.color} 18%, transparent)`, color: k.color }}>
                      <Icon d={k.icon} size={18} stroke={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`text-[15px] leading-snug ${n.read_at ? "font-medium text-muted" : "font-semibold"}`}>{n.title}</span>
                        <span className="shrink-0 text-[12px] text-muted">{ago(n.created_at)}</span>
                      </span>
                      {first && <span className="mt-0.5 block truncate text-[13px] text-muted">{first}</span>}
                      {rest.join(" ").trim() && (
                        <span className="mt-1.5 block rounded-xl px-3 py-2 text-[13px] leading-snug"
                          style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
                          “{rest.join(" ").trim()}”
                        </span>
                      )}
                    </span>
                    {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-danger" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
