"use client";
// Reports for the treasurer and viewers: events with budgets, where the money went, and CSV export.
// Spending counts every receipt that wasn't sent back (checking, approved and paid).
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { ClubEvent, Profile, Receipt } from "@/lib/types";
import { STATUS, asStatus, memberName } from "@/lib/admin";
import { ICONS, categoryStyle, money, todayIso } from "@/lib/ui";
import { Icon, Spinner, Toast } from "@/components/ui";
import { useShell } from "@/components/AppShell";

type Cat = { id: string; name: string; color: string | null };
type EventDraft = { id?: string; name: string; budget: string; starts_on: string; ends_on: string; archived: boolean };

const counts = (r: Receipt) => r.status !== "rejected";
const sum = (list: Receipt[]) => list.reduce((s, r) => s + Number(r.total), 0);

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Reports() {
  const { me, bump } = useShell();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [people, setPeople] = useState<Record<string, Pick<Profile, "display_name" | "email">>>({});
  const [cats, setCats] = useState<Record<string, Cat>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [from, setFrom] = useState(() => `${todayIso().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(() => todayIso());

  const load = useCallback(async () => {
    const [r, e, p, c] = await Promise.all([
      supabase.from("receipts").select("*").order("receipt_date", { ascending: false, nullsFirst: false }),
      supabase.from("events").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name, email"),
      supabase.from("categories").select("id, name, color"),
    ]);
    if (r.error || e.error) { setError("We couldn't load the reports."); return; }
    setError("");
    setReceipts(r.data as Receipt[]);
    setEvents(e.data as ClubEvent[]);
    setPeople(Object.fromEntries((p.data ?? []).map((m) => [m.id, m])));
    setCats(Object.fromEntries((c.data ?? []).map((x: Cat) => [x.id, x])));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, bump]); // reload when a live notification arrives (new receipt, over budget)

  const byEvent = useMemo(() => {
    const m = new Map<string, Receipt[]>();
    (receipts ?? []).forEach((r) => { if (r.event_id) m.set(r.event_id, [...(m.get(r.event_id) ?? []), r]); });
    return m;
  }, [receipts]);

  const catName = (id: string | null) => (id && cats[id]?.name) || "No category";
  const evName = (id: string | null) => (id && events.find((e) => e.id === id)?.name) || "";

  function download(list: Receipt[], name: string) {
    const head = ["Date", "Shop", "Member", "Category", "Event", "Status", "Total (THB)", "Note", "Treasurer's note"];
    const lines = list.map((r) => [
      r.receipt_date ?? r.created_at.slice(0, 10), r.shop_name ?? "", memberName(people[r.user_id]), catName(r.category_id),
      evName(r.event_id), STATUS[asStatus(r.status)].short, Number(r.total).toFixed(2), r.note ?? "", r.review_note ?? "",
    ].map(csvCell).join(","));
    // BOM so Excel opens Thai text correctly.
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name.replace(/[^\p{L}\p{N}-]+/gu, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveEvent(d: EventDraft) {
    const budget = d.budget.trim() === "" ? null : Number(d.budget.replace(/,/g, ""));
    if (!d.name.trim()) return "Give the event a name.";
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return "The budget must be a number, or leave it empty.";
    if (d.starts_on && d.ends_on && d.ends_on < d.starts_on) return "The end date is before the start date.";
    const row = { name: d.name.trim(), budget, starts_on: d.starts_on || null, ends_on: d.ends_on || null, archived: d.archived };
    const { error } = d.id
      ? await supabase.from("events").update(row).eq("id", d.id)
      : await supabase.from("events").insert(row);
    if (error) return error.message;
    setDraft(null);
    setToast(d.id ? "Event saved" : "Event added. Members can pick it when they scan.");
    await load();
    return "";
  }

  if (error) return <p className="mx-auto mt-5 max-w-md rounded-[20px] bg-surface p-5 text-[15px]">{error}</p>;
  if (!receipts) return <div className="flex justify-center py-24 text-muted" role="status"><Spinner size={28} /><span className="sr-only">Loading</span></div>;

  const visible = events.filter((e) => showArchived || !e.archived);
  const rangeRows = receipts.filter((r) => { const d = r.receipt_date ?? r.created_at.slice(0, 10); return d >= from && d <= to; });

  return (
    <div className="mx-auto w-full max-w-md px-5 pb-16 pt-5 md:max-w-3xl md:px-10">
      {toast && <Toast text={toast} onDone={() => setToast("")} />}

      {/* Events and budgets */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Events</h2>
        {me.admin && (
          <button type="button" onClick={() => setDraft({ name: "", budget: "", starts_on: "", ends_on: "", archived: false })}
            className="tap flex h-9 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-semibold text-bg">
            <Icon d={ICONS.plus} size={15} stroke={2.4} /> New event
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="mt-3 rounded-[20px] bg-surface p-5 text-[15px] text-muted">
          No events yet.{me.admin ? " Add one (e.g. “Open House 2026”) with a budget, and members can tag receipts to it." : ""}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {visible.map((ev, i) => {
            const list = byEvent.get(ev.id) ?? [];
            const live = list.filter(counts);
            const spent = sum(live);
            const waiting = sum(list.filter((r) => r.status === "pending"));
            const budget = ev.budget === null ? null : Number(ev.budget);
            const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
            const over = budget !== null && spent > budget;
            const expanded = open === ev.id;
            const byCat = new Map<string, number>(); live.forEach((r) => byCat.set(catName(r.category_id), (byCat.get(catName(r.category_id)) ?? 0) + Number(r.total)));
            const byWho = new Map<string, number>(); live.forEach((r) => byWho.set(memberName(people[r.user_id]), (byWho.get(memberName(people[r.user_id])) ?? 0) + Number(r.total)));
            return (
              <li key={ev.id} className="anim-rise rounded-[22px] bg-surface" style={{ animationDelay: `${i * 40}ms` }}>
                <button type="button" onClick={() => setOpen(expanded ? null : ev.id)} aria-expanded={expanded}
                  className="tap w-full p-4 text-left">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-1.5 text-[16px] font-semibold">
                      <Icon d={ICONS.flag} size={15} stroke={2} />
                      <span className="truncate">{ev.name}</span>
                      {ev.archived && <span className="rounded-full bg-surface2 px-2 text-[11px] font-medium text-muted">Archived</span>}
                    </p>
                    <p className="shrink-0 text-[15px] font-semibold tabular-nums" style={{ color: over ? "var(--danger)" : undefined }}>
                      ฿{money(spent)}{budget !== null && <span className="font-normal text-muted"> / {money(budget)}</span>}
                    </p>
                  </div>
                  {budget !== null && (
                    <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
                      aria-label={`${Math.round((spent / (budget || 1)) * 100)}% of budget used`}>
                      <div className="anim-grow h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${pct}%`, background: over ? "var(--danger)" : pct > 85 ? "#F5A524" : "var(--ok)", transformOrigin: "0 50%" }} />
                    </div>
                  )}
                  <p className="mt-2 text-[13px] text-muted">
                    {live.length} receipt{live.length === 1 ? "" : "s"}
                    {waiting > 0 && ` · ฿${money(waiting)} still checking`}
                    {over && ` · over by ฿${money(spent - budget!)}`}
                    {ev.starts_on && ` · ${ev.starts_on}${ev.ends_on ? ` → ${ev.ends_on}` : ""}`}
                  </p>
                </button>
                {expanded && (
                  <div className="anim-pop border-t border-line px-4 pb-4 pt-3">
                    <div className="grid gap-4 md:grid-cols-2">
                      {[{ title: "By category", m: byCat }, { title: "By member", m: byWho }].map(({ title, m }) => (
                        <div key={title}>
                          <p className="mb-1.5 text-[13px] font-medium text-muted">{title}</p>
                          {m.size === 0 ? <p className="text-[13px] text-muted">Nothing yet</p> : (
                            <ul className="flex flex-col gap-1.5">
                              {[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                                <li key={k} className="flex items-center gap-2 text-[14px]">
                                  {title === "By category" && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: categoryStyle(k).color }} />}
                                  <span className="min-w-0 flex-1 truncate">{k}</span>
                                  <span className="tabular-nums text-muted">{spent ? Math.round((v / spent) * 100) : 0}%</span>
                                  <span className="w-24 text-right font-medium tabular-nums">฿{money(v)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {me.admin && (
                        <button type="button" onClick={() => setDraft({
                          id: ev.id, name: ev.name, budget: ev.budget === null ? "" : String(ev.budget),
                          starts_on: ev.starts_on ?? "", ends_on: ev.ends_on ?? "", archived: ev.archived,
                        })} className="tap flex h-9 items-center gap-1.5 rounded-full bg-surface2 px-3.5 text-[13px] font-medium">
                          <Icon d={ICONS.pencil} size={14} /> Edit
                        </button>
                      )}
                      <button type="button" disabled={!list.length} onClick={() => download(list, ev.name)}
                        className="tap flex h-9 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-semibold text-bg disabled:opacity-40">
                        <Icon d={ICONS.download} size={14} stroke={2.2} /> Export CSV
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {events.some((e) => e.archived) && (
        <button type="button" onClick={() => setShowArchived((v) => !v)} className="tap mt-2 h-9 px-1 text-[13px] font-medium text-muted underline">
          {showArchived ? "Hide archived events" : "Show archived events"}
        </button>
      )}

      {/* Any date range */}
      <h2 className="mt-8 text-lg font-semibold">Export by dates</h2>
      <div className="mt-3 rounded-[22px] bg-surface p-4">
        <div className="grid grid-cols-2 gap-2">
          {([["From", from, setFrom], ["To", to, setTo]] as const).map(([label, value, set]) => (
            <label key={label} className="field-card flex flex-col rounded-2xl bg-surface2 px-3.5 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
              <input type="date" value={value} onChange={(e) => e.target.value && set(e.target.value)}
                className="h-7 w-full bg-transparent text-[15px] font-medium tabular-nums outline-none" />
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            {rangeRows.length} receipts · ฿{money(sum(rangeRows.filter(counts)))} spent
            {rangeRows.some((r) => r.status === "approved") && ` · ฿${money(sum(rangeRows.filter((r) => r.status === "approved")))} still to pay back`}
          </p>
          <button type="button" disabled={!rangeRows.length} onClick={() => download(rangeRows, `receipts-${from}-to-${to}`)}
            className="tap flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg disabled:opacity-40">
            <Icon d={ICONS.download} size={14} stroke={2.2} /> Export CSV
          </button>
        </div>
      </div>

      {draft && <EventSheet draft={draft} onClose={() => setDraft(null)} onSave={saveEvent} />}
    </div>
  );
}

function EventSheet({ draft, onClose, onSave }: { draft: EventDraft; onClose: () => void; onSave: (d: EventDraft) => Promise<string> }) {
  const [d, setD] = useState(draft);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const field = "field-card flex min-h-[52px] items-center gap-3 border-b border-line";
  const input = "min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none placeholder:text-muted";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <div className="anim-dim absolute inset-0 bg-black/40" onClick={() => !saving && onClose()} />
      <form className="anim-sheet relative w-full max-w-md rounded-t-[28px] bg-bg p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:rounded-[28px]"
        onSubmit={async (e) => { e.preventDefault(); setSaving(true); const m = await onSave(d); setSaving(false); setErr(m); }}>
        <p id="event-title" className="text-lg font-semibold">{d.id ? "Edit event" : "New event"}</p>
        <div className="mt-4 rounded-[20px] bg-surface px-4">
          <label className={field}><span className="w-20 shrink-0 text-[15px]">Name</span>
            <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={80} required autoFocus placeholder="Open House 2026" className={input} /></label>
          <label className={field}><span className="w-20 shrink-0 text-[15px]">Budget ฿</span>
            <input value={d.budget} onChange={(e) => setD({ ...d, budget: e.target.value })} inputMode="decimal" placeholder="No limit" className={input} /></label>
          <label className={field}><span className="w-20 shrink-0 text-[15px]">Starts</span>
            <input type="date" value={d.starts_on} onChange={(e) => setD({ ...d, starts_on: e.target.value })} className={input} /></label>
          <label className={`${field} border-b-0`}><span className="w-20 shrink-0 text-[15px]">Ends</span>
            <input type="date" value={d.ends_on} onChange={(e) => setD({ ...d, ends_on: e.target.value })} className={input} /></label>
        </div>
        {d.id && (
          <label className="mt-3 flex items-center justify-between rounded-[20px] bg-surface px-4 py-3 text-[15px]">
            Archived <span className="text-[13px] text-muted">(hidden when scanning)</span>
            <input type="checkbox" checked={d.archived} onChange={(e) => setD({ ...d, archived: e.target.checked })} className="h-5 w-5 accent-[#22D27F]" />
          </label>
        )}
        {err && <p role="alert" className="mt-3 text-sm text-danger">{err}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onClose} disabled={saving} className="tap h-12 rounded-2xl bg-surface text-[15px] font-medium">Cancel</button>
          <button type="submit" disabled={saving} className="tap flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-semibold text-ink">
            {saving && <Spinner />} Save
          </button>
        </div>
      </form>
    </div>
  );
}
