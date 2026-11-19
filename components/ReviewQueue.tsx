"use client";
// The treasurer's inbox: check new receipts, send them back with a reason, and pay members back.
// The database trigger (receipts_guard) enforces every rule here; this screen only offers the allowed moves.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";
import { RECEIPTS_BUCKET, type ClubEvent, type Profile, type Receipt } from "@/lib/types";
import { SEND_BACK_REASONS, memberName } from "@/lib/admin";
import { ICONS, categoryStyle, longDate, money } from "@/lib/ui";
import { Icon, Spinner, Toast } from "@/components/ui";
import { useShell } from "@/components/AppShell";

type Tab = "pending" | "approved" | "rejected";
const TABS: { v: Tab; label: string; empty: string }[] = [
  { v: "pending", label: "To check", empty: "Nothing to check. New receipts from members show up here." },
  { v: "approved", label: "To pay", empty: "Nobody is waiting to be paid back." },
  { v: "rejected", label: "Sent back", empty: "No receipts are waiting for a member to fix them." },
];
type Cat = { id: string; name: string; color: string | null };

export default function ReviewQueue() {
  const { refreshCounts, pending, bump } = useShell();
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [people, setPeople] = useState<Record<string, Pick<Profile, "display_name" | "email">>>({});
  const [cats, setCats] = useState<Record<string, Cat>>({});
  const [events, setEvents] = useState<Record<string, ClubEvent>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [sendBack, setSendBack] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    const [r, p, c, e] = await Promise.all([
      supabase.from("receipts").select("*").in("status", ["pending", "approved", "rejected"]).order("created_at", { ascending: true }),
      supabase.from("profiles").select("id, display_name, email"),
      supabase.from("categories").select("id, name, color"),
      supabase.from("events").select("*"),
    ]);
    if (r.error) { setError("We couldn't load receipts to review."); return; }
    setError("");
    const list = (r.data ?? []) as Receipt[];
    setRows(list);
    setPeople(Object.fromEntries((p.data ?? []).map((m) => [m.id, m])));
    setCats(Object.fromEntries((c.data ?? []).map((x: Cat) => [x.id, x])));
    setEvents(Object.fromEntries(((e.data ?? []) as ClubEvent[]).map((x) => [x.id, x])));
    // Photo thumbnails so the treasurer can compare without opening each one.
    const paths = [...new Set(list.map((x) => x.image_path).filter((x): x is string => !!x && !x.toLowerCase().endsWith(".pdf")))];
    if (paths.length) {
      const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrls(paths, 3600);
      const urls: Record<string, string> = {};
      (data ?? []).forEach((d) => { if (d.path && d.signedUrl) urls[d.path] = d.signedUrl; });
      setThumbs(urls);
    }
  }, []);

  // Reload whenever the live "to check" count changes (a member sent or fixed a receipt).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, pending, bump]);

  const counts = useMemo(() => ({
    pending: rows?.filter((r) => r.status === "pending").length ?? 0,
    approved: rows?.filter((r) => r.status === "approved").length ?? 0,
    rejected: rows?.filter((r) => r.status === "rejected").length ?? 0,
  }), [rows]);
  const shown = useMemo(() => rows?.filter((r) => r.status === tab) ?? [], [rows, tab]);

  async function setStatus(ids: string[], status: "approved" | "paid" | "rejected", note?: string, message?: string) {
    setBusy(ids.join(","));
    const patch = note !== undefined ? { status, review_note: note } : { status };
    const { error } = await supabase.from("receipts").update(patch).in("id", ids);
    setBusy(null);
    if (error) { setToast(error.message || "Couldn't update. Try again."); return; }
    setRows((all) => all?.map((r) => ids.includes(r.id) ? { ...r, status, review_note: note ?? r.review_note } : r) ?? null);
    setToast(message ?? "Updated");
    refreshCounts();
  }

  // "To pay" is grouped per member, so one transfer can settle several receipts.
  const owed = useMemo(() => {
    const m = new Map<string, Receipt[]>();
    shown.forEach((r) => m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]));
    return [...m.entries()].map(([uid, list]) => ({ uid, list, sum: list.reduce((s, r) => s + Number(r.total), 0) }))
      .sort((a, b) => b.sum - a.sum);
  }, [shown]);

  function card(r: Receipt, i: number) {
    const cat = r.category_id ? cats[r.category_id] : undefined;
    const style = categoryStyle(cat?.name, cat?.color);
    const ev = r.event_id ? events[r.event_id] : undefined;
    const thumb = r.image_path ? thumbs[r.image_path] : undefined;
    const isBusy = busy?.includes(r.id);
    return (
      <li key={r.id} className="anim-rise rounded-[22px] bg-surface p-3.5" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
        <div className="flex gap-3">
          <Link href={`/receipts/${r.id}`} className="tap shrink-0" aria-label="Open receipt and photo">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="h-[76px] w-[58px] rounded-lg object-cover" />
            ) : (
              <span className="flex h-[76px] w-[58px] items-center justify-center rounded-lg bg-surface2 text-muted"><Icon d={ICONS.file} size={22} /></span>
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-[15px] font-semibold">{r.shop_name || "Unknown shop"}</p>
              <p className="shrink-0 text-[17px] font-semibold tabular-nums">฿{money(Number(r.total))}</p>
            </div>
            <p className="truncate text-[13px] text-muted">{memberName(people[r.user_id])} · {longDate(r.receipt_date)}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-ink" style={{ background: style.color }}>
                <Icon d={style.icon} size={12} stroke={2} />{cat?.name ?? "No category"}
              </span>
              {ev && (
                <span className="flex h-6 items-center gap-1 rounded-full bg-surface2 px-2 text-[12px] font-medium">
                  <Icon d={ICONS.flag} size={12} stroke={2} />{ev.name}
                </span>
              )}
            </div>
          </div>
        </div>
        {r.note && <p className="mt-2.5 rounded-xl bg-surface2 px-3 py-2 text-[13px]">“{r.note}”</p>}
        {r.status === "rejected" && r.review_note && (
          <p className="mt-2.5 rounded-xl px-3 py-2 text-[13px]" style={{ background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>
            You wrote: “{r.review_note}”
          </p>
        )}
        {r.status === "pending" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={!!isBusy} onClick={() => setSendBack(r)}
              className="tap h-11 rounded-2xl bg-surface2 text-[15px] font-medium">Send back</button>
            <button type="button" disabled={!!isBusy} onClick={() => void setStatus([r.id], "approved", undefined, "Approved. The member was notified.")}
              className="tap flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-brand text-[15px] font-semibold text-ink">
              {isBusy ? <Spinner /> : <Icon d={ICONS.check} size={17} stroke={2.4} />} Approve
            </button>
          </div>
        )}
        {r.status === "approved" && (
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" disabled={!!isBusy} onClick={() => setSendBack(r)}
              className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium">Send back</button>
            <button type="button" disabled={!!isBusy} onClick={() => void setStatus([r.id], "paid", undefined, "Marked as paid back.")}
              className="tap h-9 rounded-full bg-fg px-3.5 text-[13px] font-semibold text-bg">Paid</button>
          </div>
        )}
        {r.status === "rejected" && (
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={!!isBusy} onClick={() => void setStatus([r.id], "approved", undefined, "Approved anyway.")}
              className="tap h-9 rounded-full bg-surface2 px-3.5 text-[13px] font-medium">Approve anyway</button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-16 pt-5 md:max-w-3xl md:px-10">
      {toast && <Toast text={toast} onDone={() => setToast("")} />}

      <div role="tablist" aria-label="Review status" className="grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1">
        {TABS.map((t) => (
          <button key={t.v} type="button" role="tab" aria-selected={tab === t.v} onClick={() => setTab(t.v)}
            className={`tap flex h-[38px] items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors ${tab === t.v ? "bg-fg text-bg" : "text-muted"}`}>
            {t.label}
            {counts[t.v] > 0 && <span className={`text-[12px] tabular-nums ${tab === t.v ? "opacity-70" : ""}`}>{counts[t.v]}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {rows === null && !error ? (
          <div className="flex justify-center py-24 text-muted" role="status"><Spinner size={28} /><span className="sr-only">Loading</span></div>
        ) : error ? (
          <p className="rounded-[20px] bg-surface p-5 text-[15px]">{error}</p>
        ) : shown.length === 0 ? (
          <p className="rounded-[20px] bg-surface p-6 text-center text-[15px] text-muted">{TABS.find((t) => t.v === tab)!.empty}</p>
        ) : tab === "approved" ? (
          <div className="flex flex-col gap-5">
            {owed.map((g) => (
              <section key={g.uid} aria-label={`Owed to ${memberName(people[g.uid])}`}>
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <div>
                    <p className="text-[15px] font-semibold">{memberName(people[g.uid])}</p>
                    <p className="text-[13px] text-muted">{g.list.length} receipt{g.list.length === 1 ? "" : "s"} · owed ฿{money(g.sum)}</p>
                  </div>
                  <button type="button" disabled={!!busy}
                    onClick={() => void setStatus(g.list.map((r) => r.id), "paid", undefined, `Paid ${memberName(people[g.uid])} ฿${money(g.sum)}.`)}
                    className="tap flex h-10 items-center gap-1.5 rounded-full bg-brand px-4 text-[14px] font-semibold text-ink">
                    <Icon d={ICONS.check} size={16} stroke={2.4} /> Paid all
                  </button>
                </div>
                <ul className="flex flex-col gap-2">{g.list.map(card)}</ul>
              </section>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">{shown.map(card)}</ul>
        )}
      </div>

      {sendBack && (
        <SendBackSheet receipt={sendBack} who={memberName(people[sendBack.user_id])}
          onClose={() => setSendBack(null)}
          onSend={async (note) => { const r = sendBack; setSendBack(null); await setStatus([r.id], "rejected", note, `Sent back to ${memberName(people[r.user_id])}.`); }} />
      )}
    </div>
  );
}

/** Bottom sheet: pick or type the reason. The member sees it in their notification. */
export function SendBackSheet({ receipt, who, onClose, onSend }: {
  receipt: Pick<Receipt, "shop_name" | "total">; who: string; onClose: () => void; onSend: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby="sendback-title">
      <div className="anim-dim absolute inset-0 bg-black/40" onClick={() => !sending && onClose()} />
      <form className="anim-sheet relative w-full max-w-md rounded-t-[28px] bg-bg p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:rounded-[28px]"
        onSubmit={async (e) => { e.preventDefault(); if (!note.trim() || sending) return; setSending(true); await onSend(note.trim()); }}>
        <p id="sendback-title" className="text-lg font-semibold">Send back to {who}</p>
        <p className="mt-0.5 text-[13px] text-muted">{receipt.shop_name || "Receipt"} · ฿{money(Number(receipt.total))}. They&apos;ll get a notification with your reason.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {SEND_BACK_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setNote(r)} aria-pressed={note === r}
              className={`tap rounded-full px-3 py-1.5 text-left text-[13px] font-medium ${note === r ? "bg-fg text-bg" : "bg-surface"}`}>{r}</button>
          ))}
        </div>
        <label className="field-card mt-3 block rounded-[18px] bg-surface p-3.5">
          <span className="block text-[13px] text-muted">Reason</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} autoFocus required
            placeholder="What should they fix?" className="mt-1 w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted" />
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onClose} disabled={sending} className="tap h-12 rounded-2xl bg-surface text-[15px] font-medium">Cancel</button>
          <button type="submit" disabled={!note.trim() || sending}
            className="tap flex h-12 items-center justify-center gap-2 rounded-2xl bg-danger text-[15px] font-semibold text-white disabled:opacity-40">
            {sending && <Spinner />} Send back
          </button>
        </div>
      </form>
    </div>
  );
}
