"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import type { Receipt } from "@/lib/types";
import { ICONS, categoryStyle, money, moneyParts, recallMonth, rememberMonth, takeFlash, type Flash } from "@/lib/ui";
import { Icon, RoundButton, Spinner, ThemeToggle, Toast } from "@/components/ui";

type CategoryInfo = { id: string; name: string; color: string | null };

// Tile layouts for 1–5 categories: [grid-area per tile], grid rows.
const LAYOUTS: Record<number, { areas: string[]; rows: string }> = {
  1: { areas: ["1 / 1 / 2 / 3"], rows: "104px" },
  2: { areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3"], rows: "104px" },
  3: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"], rows: "92px 92px" },
  4: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "3 / 1 / 4 / 3"], rows: "92px 92px 58px" },
  5: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "3 / 1 / 4 / 2", "3 / 2 / 4 / 3"], rows: "92px 92px 58px" },
};

/** "YYYY-MM" the receipt belongs to (receipt date, else the day it was saved). */
function monthOf(r: Receipt) {
  return (r.receipt_date ?? r.created_at.slice(0, 10)).slice(0, 7);
}
function dayOf(r: Receipt) {
  return r.receipt_date ?? r.created_at.slice(0, 10);
}
function ymOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function shiftYm(ym: string, by: number) {
  const [y, m] = ym.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + by, 1));
}
function ymLabel(ym: string, opts: Intl.DateTimeFormatOptions) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", opts);
}
function dayLabel(iso: string, today: string, yesterday: string) {
  if (iso === today) return "Today";
  if (iso === yesterday) return "Yesterday";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function ExpenseList() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [categories, setCategories] = useState<Record<string, CategoryInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [now] = useState(() => new Date());
  const thisMonth = ymOf(now);
  // Come back to the month you were looking at (e.g. after opening a receipt).
  const [month, setMonth] = useState(() => {
    const m = recallMonth();
    return m && m <= thisMonth ? m : thisMonth;
  });
  const [dir, setDir] = useState<"left" | "right" | null>(null);

  useEffect(() => { rememberMonth(month); }, [month]);
  useEffect(() => {
    if (!highlight.length) return;
    const t = setTimeout(() => setHighlight([]), 1800);
    return () => clearTimeout(t);
  }, [highlight]);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        supabase
          .from("receipts")
          .select("*")
          .order("receipt_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase.from("categories").select("id, name, color"),
      ]);
      if (r.error) {
        setError("We couldn't load your receipts. Try again in a moment.");
        return;
      }
      setError("");
      setReceipts((r.data ?? []) as Receipt[]);
      const map: Record<string, CategoryInfo> = {};
      (c.data ?? []).forEach((cat: CategoryInfo) => { map[cat.id] = cat; });
      setCategories(map);
    } catch {
      setError("Can't reach the server. Check your internet and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data load and a one-time message left by the previous page.
    const f = takeFlash();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlash(f);
    // Just saved or deleted something: show the month it belongs to.
    if (f?.month && f.month <= thisMonth) setMonth(f.month);
    if (f?.ids?.length) setHighlight(f.ids);
    load();
  }, [load, thisMonth]);

  const earliest = useMemo(
    () => receipts.reduce((min, r) => (monthOf(r) < min ? monthOf(r) : min), thisMonth),
    [receipts, thisMonth],
  );
  const latestWithData = useMemo(
    () => receipts.map(monthOf).filter((m) => m <= thisMonth).sort().pop() ?? null,
    [receipts, thisMonth],
  );

  const view = useMemo(() => {
    const inMonth = receipts.filter((r) => monthOf(r) === month);
    const total = inMonth.reduce((s, r) => s + Number(r.total), 0);
    const prevTotal = receipts.filter((r) => monthOf(r) === shiftYm(month, -1)).reduce((s, r) => s + Number(r.total), 0);

    const sums = new Map<string, number>();
    inMonth.forEach((r) => {
      const key = r.category_id ?? "none";
      sums.set(key, (sums.get(key) ?? 0) + Number(r.total));
    });
    const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const layout = LAYOUTS[ranked.length];
    const tiles = ranked.map(([key, sum], i) => {
      const cat = key === "none" ? undefined : categories[key];
      const style = categoryStyle(cat?.name, cat?.color);
      return {
        key, style, pct: total > 0 ? Math.round((sum / total) * 100) : 0, sum,
        fullName: cat?.name ?? "No category", area: layout.areas[i],
        small: ranked.length >= 4 && i >= 3, big: i === 0 && ranked.length >= 3,
      };
    });

    // Rows for the list, grouped by day
    const shown = filter ? inMonth.filter((r) => (r.category_id ?? "none") === filter) : inMonth;
    const groups: { day: string; items: Receipt[] }[] = [];
    shown.forEach((r) => {
      const d = dayOf(r);
      const last = groups[groups.length - 1];
      if (last && last.day === d) last.items.push(r);
      else groups.push({ day: d, items: [r] });
    });
    return { inMonth, total, prevTotal, tiles, rows: layout?.rows, groups };
  }, [receipts, categories, filter, month]);

  function goMonth(by: number) {
    const next = shiftYm(month, by);
    if (next > thisMonth || next < earliest) return;
    setDir(by > 0 ? "right" : "left");
    setFilter(null);
    setMonth(next);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function undoDelete(row: Receipt) {
    setFlash(null);
    const { error } = await supabase.from("receipts").insert(row);
    if (error) {
      setFlash({ text: "Couldn't bring it back. Scan it again if needed." });
      return;
    }
    setHighlight([row.id]);
    setMonth(monthOf(row));
    await load();
  }

  const isThisMonth = month === thisMonth;
  const monthLong = ymLabel(month, { month: "long" });
  const [main, dec] = moneyParts(view.total);
  const diff = view.total - view.prevTotal;
  const prevShort = ymLabel(shiftYm(month, -1), { month: "short" });
  const filterName = filter ? (filter === "none" ? "No category" : categories[filter]?.name ?? "Category") : null;
  const todayIso = `${thisMonth}-${String(now.getDate()).padStart(2, "0")}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const yesterdayIso = `${ymOf(y)}-${String(y.getDate()).padStart(2, "0")}`;
  const slide = dir === "right" ? "anim-from-right" : dir === "left" ? "anim-from-left" : "anim-fade";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col md:max-w-6xl">
      {flash && (
        <Toast
          text={flash.text}
          ms={flash.undoRow || flash.scanNext ? 4500 : 2600}
          actionLabel={flash.undoRow ? "Undo" : flash.scanNext ? "Scan next" : undefined}
          onAction={flash.undoRow ? () => undoDelete(flash.undoRow!) : flash.scanNext ? () => router.push("/scan") : undefined}
          onDone={() => setFlash(null)}
        />
      )}

      <div className="flex flex-1 flex-col gap-6 px-5 pb-36 pt-[max(24px,env(safe-area-inset-top))] md:px-10 md:pb-16 md:pt-10 lg:px-12">
        <header className="flex items-center justify-between">
          <h1 className="text-[30px] font-semibold tracking-[-0.03em] md:text-[36px]">Expenses</h1>
          <div className="flex gap-2">
            <Link href="/scan"
              className="tap hidden h-11 items-center gap-2 rounded-full bg-fg pl-4 pr-5 text-[15px] font-semibold text-bg md:flex">
              <Icon d={ICONS.camera} size={20} stroke={1.9} /> Scan receipt
            </Link>
            <ThemeToggle />
            <RoundButton icon={ICONS.logout} aria-label="Log out" onClick={logout} />
          </div>
        </header>

        {/* Month picker */}
        <nav aria-label="Choose month" className="-mt-2 flex items-center justify-between rounded-full bg-surface p-1 md:mt-0 md:max-w-[380px]">
          <button type="button" onClick={() => goMonth(-1)} disabled={month <= earliest}
            aria-label={`Previous month, ${ymLabel(shiftYm(month, -1), { month: "long", year: "numeric" })}`}
            className="tap flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-25">
            <Icon d={ICONS.back} size={18} stroke={2.2} />
          </button>
          <p aria-live="polite" className="text-[15px] font-semibold">
            {ymLabel(month, { month: "long", year: "numeric" })}
            {isThisMonth && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 align-[2px] text-[11px] font-semibold text-ink">Now</span>}
          </p>
          <button type="button" onClick={() => goMonth(1)} disabled={isThisMonth}
            aria-label={`Next month, ${ymLabel(shiftYm(month, 1), { month: "long", year: "numeric" })}`}
            className="tap flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-25">
            <Icon d={ICONS.chevron} size={18} stroke={2.2} />
          </button>
        </nav>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-24 text-muted" role="status">
            <Spinner size={28} /><span className="sr-only">Loading receipts</span>
          </div>
        ) : error ? (
          <div className="rounded-[20px] bg-surface p-5">
            <p className="text-[15px]">{error}</p>
            <button type="button" onClick={() => { setLoading(true); load(); }}
              className="tap mt-4 h-11 rounded-full bg-surface2 px-4 text-[15px] font-medium">Try again</button>
          </div>
        ) : (
          // Phone: one column. Tablet/desktop: summary + tiles on the left, the list on the right.
          <div key={month} className={`flex flex-col gap-6 md:grid md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start md:gap-x-8 lg:gap-x-12 ${slide}`}>
            <section aria-label={`Spending in ${monthLong}`} className="md:col-start-1 md:row-start-1">
              <p className="text-sm text-muted">{isThisMonth ? "Spent this month" : `Spent in ${monthLong}`}</p>
              <p className="mt-1.5 text-[56px] font-semibold leading-none tracking-[-0.05em] tabular-nums">
                <span className="mr-0.5 align-[18px] text-[28px] font-medium tracking-normal">฿</span>{main}
                <span className="text-[26px] tracking-normal text-muted">{dec}</span>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="rounded-full bg-surface px-2.5 py-1 font-medium">
                  {view.inMonth.length} receipt{view.inMonth.length === 1 ? "" : "s"}
                </span>
                {view.prevTotal > 0 && view.total > 0 && Math.abs(diff) >= 0.01 && (
                  <span className="rounded-full bg-surface px-2.5 py-1 text-muted">
                    <span className={diff > 0 ? "text-danger" : "text-ok"}>{diff > 0 ? "↑" : "↓"} ฿{money(Math.abs(diff))}</span> vs {prevShort}
                  </span>
                )}
              </div>
            </section>

            {view.inMonth.length === 0 ? (
              <section className="rounded-3xl bg-surface p-5 md:col-start-2 md:row-span-2 md:row-start-1 md:p-8">
                <div aria-hidden="true" className="mb-4 flex gap-1.5">
                  <span className="h-9 w-9 rounded-xl bg-[#22D27F]" />
                  <span className="h-9 w-9 rounded-xl bg-[#0EB6F2]" />
                  <span className="h-9 w-9 rounded-xl bg-[#FFB34F]" />
                </div>
                <p className="text-[17px] font-semibold">No receipts in {monthLong}{isThisMonth ? " yet" : ""}</p>
                <p className="mt-1 text-[15px] leading-snug text-muted">
                  {isThisMonth ? "Scan a receipt and it shows up here with its category." : "Nothing was saved for this month."}
                </p>
                {latestWithData && latestWithData !== month && (
                  <button type="button" onClick={() => { setDir(latestWithData > month ? "right" : "left"); setMonth(latestWithData); }}
                    className="tap mt-4 flex h-11 items-center gap-1.5 rounded-full bg-surface2 px-4 text-[15px] font-medium">
                    Show {ymLabel(latestWithData, { month: "long" })} <Icon d={ICONS.chevron} size={16} stroke={2.2} />
                  </button>
                )}
              </section>
            ) : (
              <>
                <div className="grid grid-cols-[1.2fr_1fr] gap-2 md:col-start-1 md:row-start-2" style={{ gridTemplateRows: view.rows }}>
                  {view.tiles.map((t, i) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setFilter(filter === t.key ? null : t.key)}
                      aria-pressed={filter === t.key}
                      aria-label={`${t.fullName}, ${t.pct} percent, ฿${money(t.sum)}. ${filter === t.key ? "Show all receipts" : "Show only this category"}`}
                      className={`tap anim-rise relative flex overflow-hidden rounded-[22px] px-3.5 py-3 text-left text-ink ${t.small ? "flex-row items-center justify-between" : "flex-col items-start justify-between"}`}
                      style={{ gridArea: t.area, background: t.style.color, opacity: filter && filter !== t.key ? 0.3 : 1, animationDelay: `${i * 50}ms` }}
                    >
                      {!t.small && <Icon d={t.style.icon} size={18} className="absolute right-3 top-3 opacity-55" />}
                      <span className={`font-semibold leading-none tracking-[-0.04em] tabular-nums ${t.big ? "text-[48px]" : t.small ? "text-lg" : "text-[30px]"}`}>{t.pct}%</span>
                      <span className="text-[13px] font-medium">{t.style.short}</span>
                    </button>
                  ))}
                </div>

                <section className="relative pt-5 md:col-start-2 md:row-span-2 md:row-start-1" aria-labelledby="list-title">
                  <div aria-hidden="true" className="absolute inset-x-7 top-0 h-20 rounded-[22px] bg-[#FFB34F]" />
                  <div aria-hidden="true" className="absolute inset-x-3.5 top-[7px] h-20 rounded-[22px] bg-[#C38BFA]" />
                  <div aria-hidden="true" className="absolute inset-x-0 top-3.5 h-20 rounded-[22px] bg-[#0EB6F2]" />
                  <div className="relative rounded-3xl bg-surface px-1.5 pb-1.5 pt-2">
                    <div className="flex min-h-8 items-center justify-between px-3 pb-1 pt-2.5">
                      <h2 id="list-title" className="text-[17px] font-semibold tracking-[-0.01em]">{filterName ?? "Receipts"}</h2>
                      {filter && (
                        <button type="button" onClick={() => setFilter(null)}
                          className="tap flex h-8 items-center gap-1.5 rounded-2xl bg-surface2 px-3 text-[13px] font-medium">
                          Show all <Icon d={ICONS.close} size={14} stroke={2} />
                        </button>
                      )}
                    </div>

                    {view.groups.map((g, gi) => (
                      <div key={g.day}>
                        <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted">{dayLabel(g.day, todayIso, yesterdayIso)}</p>
                        <ul>
                          {g.items.map((r, i) => {
                            const cat = r.category_id ? categories[r.category_id] : undefined;
                            const style = categoryStyle(cat?.name, cat?.color);
                            return (
                              <li key={r.id}>
                                <Link
                                  href={`/receipts/${r.id}`}
                                  className={`tap press anim-rise flex items-center gap-3 rounded-[18px] p-2.5 ${highlight.includes(r.id) ? "anim-flash" : ""}`}
                                  style={{ animationDelay: `${Math.min(gi * 2 + i, 8) * 40}ms` }}
                                >
                                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[14px] text-ink" style={{ background: style.color }}>
                                    <Icon d={style.icon} />
                                  </span>
                                  <span className="flex min-w-0 flex-1 flex-col">
                                    <span className="truncate text-[15px] font-medium leading-snug">{r.shop_name || "Unknown shop"}</span>
                                    <span className="text-[13px] leading-snug text-muted">{cat?.name ?? "No category"}</span>
                                  </span>
                                  <span className="shrink-0 text-[15px] font-semibold tabular-nums">฿{money(Number(r.total))}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-[max(28px,env(safe-area-inset-bottom))] md:hidden">
        <Link href="/scan"
          className="tap pointer-events-auto flex h-[60px] items-center gap-2.5 rounded-full bg-fg pl-[22px] pr-7 text-base font-semibold text-bg shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
          <Icon d={ICONS.camera} size={22} stroke={1.9} />
          Scan receipt
        </Link>
      </div>
    </div>
  );
}
