"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import type { Receipt } from "@/lib/types";
import { ICONS, categoryStyle, money, moneyParts, takeFlash, type Flash } from "@/lib/ui";
import { Icon, RoundButton, Spinner, ThemeToggle, Toast } from "@/components/ui";

type CategoryInfo = { id: string; name: string; color: string | null };
type Range = 1 | 3 | 6 | 12;

const RANGES: { v: Range; label: string; long: string }[] = [
  { v: 1, label: "1M", long: "1 month" },
  { v: 3, label: "3M", long: "3 months" },
  { v: 6, label: "6M", long: "6 months" },
  { v: 12, label: "1Y", long: "1 year" },
];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKS: [number, number, string][] = [[1, 7, "1–7"], [8, 14, "8–14"], [15, 21, "15–21"], [22, 31, "22+"]];
const CHART_H = 112;

// Tile layouts for 1–5 categories: [grid-area per tile], grid rows.
const LAYOUTS: Record<number, { areas: string[]; rows: string }> = {
  1: { areas: ["1 / 1 / 2 / 3"], rows: "96px" },
  2: { areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3"], rows: "96px" },
  3: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"], rows: "84px 84px" },
  4: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "3 / 1 / 4 / 3"], rows: "84px 84px 56px" },
  5: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "3 / 1 / 4 / 2", "3 / 2 / 4 / 3"], rows: "84px 84px 56px" },
};
const FALLBACK_TABS = ["#0EB6F2", "#C38BFA", "#FFB34F"];

/** Months as one number (year * 12 + month index) so ranges are simple arithmetic. */
const mIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const dayIso = (r: Receipt) => r.receipt_date ?? r.created_at.slice(0, 10);
const sumOf = (rows: Receipt[]) => rows.reduce((s, r) => s + Number(r.total), 0);

const VIEW_KEY = "rs-range";
function recallView(): { range: Range; offset: number } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null");
    return v && [1, 3, 6, 12].includes(v.range) && Number.isInteger(v.offset) && v.offset >= 0 ? v : null;
  } catch {
    return null;
  }
}

/** Animates a number toward its target (ease-out), for the big total. */
function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / 520);
      const v = start + (target - start) * (1 - Math.pow(1 - k, 3));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/** A folder shape: a raised tab on the left with a soft S-curve into the body. */
function Folder({ color, tab, className = "", style, children, bodyClass = "" }: {
  color: string; tab: string; className?: string; style?: React.CSSProperties; children?: React.ReactNode; bodyClass?: string;
}) {
  return (
    <div className={className} style={style}>
      <div className="flex items-end">
        <div className="h-[26px] rounded-t-[18px] transition-colors duration-500" style={{ width: tab, background: color }} />
        <svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true" className="-ml-px shrink-0">
          <path d="M0 0 C15 0 14 26 30 26 L0 26 Z" fill={color} className="transition-colors duration-500" />
        </svg>
      </div>
      <div className={`-mt-px rounded-b-3xl rounded-tr-3xl transition-colors duration-500 ${bodyClass}`} style={{ background: color }}>
        {children}
      </div>
    </div>
  );
}

export default function ExpenseList() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [categories, setCategories] = useState<Record<string, CategoryInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<Flash | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [now] = useState(() => new Date());
  const thisM = now.getFullYear() * 12 + now.getMonth();

  const [range, setRange] = useState<Range>(() => recallView()?.range ?? 3);
  const [offset, setOffset] = useState(() => recallView()?.offset ?? 0);
  const [focus, setFocus] = useState<string | null>(null);
  const [bar, setBar] = useState<number | null>(null);
  const [tick, setTick] = useState(0); // replays entrance animations when the view changes
  const [compact, setCompact] = useState(false);

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
    const f = takeFlash();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlash(f);
    // Just deleted something: show the month it belonged to.
    if (f?.month) {
      const m = mIndex(`${f.month}-01`);
      if (m <= thisM) { setRange(1); setOffset(thisM - m); }
    }
    if (f?.ids?.length) setHighlight(f.ids);
    load();
  }, [load, thisM]);

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ range, offset })); } catch { /* not remembered */ }
  }, [range, offset]);

  useEffect(() => {
    if (!highlight.length) return;
    const t = setTimeout(() => setHighlight([]), 1800);
    return () => clearTimeout(t);
  }, [highlight]);

  // The floating Scan button shrinks to an icon once the page is scrolled.
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const earliest = useMemo(
    () => receipts.reduce((min, r) => Math.min(min, mIndex(dayIso(r))), thisM),
    [receipts, thisM],
  );

  const view = useMemo(() => {
    const end = thisM - offset * range;
    const start = end - range + 1;
    const inRange = receipts.filter((r) => { const m = mIndex(dayIso(r)); return m >= start && m <= end; });
    const total = sumOf(inRange);
    const keyOf = (r: Receipt) => r.category_id ?? "none";
    const focused = focus ? inRange.filter((r) => keyOf(r) === focus) : inRange;

    // Period label
    const sy = Math.floor(start / 12), sm = start % 12, ey = Math.floor(end / 12), em = end % 12;
    const label = range === 1
      ? `${FULL[em]} ${ey}`
      : sy === ey ? `${MON[sm]} – ${MON[em]} ${ey}` : `${MON[sm]} ${sy} – ${MON[em]} ${ey}`;

    // Chart: weeks for 1M/3M, months for 6M/1Y
    const buckets: { rows: Receipt[]; label: string; title: string }[] = [];
    for (let m = start; m <= end; m++) {
      const mi = m % 12, y = Math.floor(m / 12);
      const inMonth = inRange.filter((r) => mIndex(dayIso(r)) === m);
      if (range <= 3) {
        WEEKS.forEach(([a, b, wl], i) => buckets.push({
          rows: inMonth.filter((r) => { const d = Number(dayIso(r).slice(8, 10)); return d >= a && d <= b; }),
          label: range === 1 ? wl : i === 0 ? MON[mi] : "",
          title: `${wl} ${MON[mi]}`,
        }));
      } else {
        buckets.push({ rows: inMonth, label: range === 6 ? MON[mi] : MON[mi][0], title: `${MON[mi]} ${y}` });
      }
    }
    const max = Math.max(1, ...buckets.map((b) => sumOf(b.rows)));

    // Category tiles, biggest first
    const sums = new Map<string, number>();
    inRange.forEach((r) => sums.set(keyOf(r), (sums.get(keyOf(r)) ?? 0) + Number(r.total)));
    const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const layout = LAYOUTS[ranked.length];
    const tiles = ranked.map(([key, sum], i) => {
      const cat = key === "none" ? undefined : categories[key];
      return {
        key, sum, style: categoryStyle(cat?.name, cat?.color), fullName: cat?.name ?? "No category",
        pct: total > 0 ? Math.round((sum / total) * 100) : 0, area: layout.areas[i],
        small: ranked.length >= 4 && i >= 3, big: i === 0 && ranked.length >= 3,
      };
    });

    return { start, end, label, inRange, total, focused, focusedTotal: sumOf(focused), buckets, max, tiles, rows: layout?.rows, keyOf };
  }, [receipts, categories, range, offset, focus, thisM]);

  const shownTotal = useCountUp(view.focusedTotal);
  const [main, dec] = moneyParts(shownTotal);
  const canPrev = view.start > earliest;
  const canNext = offset > 0;

  function change(patch: { range?: Range; offset?: number; focus?: string | null }) {
    if (patch.range !== undefined) setRange(patch.range);
    if (patch.offset !== undefined) setOffset(patch.offset);
    if (patch.focus !== undefined) setFocus(patch.focus);
    if (patch.range !== undefined || patch.offset !== undefined) setFocus(patch.focus ?? null);
    setBar(null);
    setTick((t) => t + 1);
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
    await load();
  }

  const focusTile = focus ? view.tiles.find((t) => t.key === focus) : undefined;
  const focusColor = focusTile?.style.color;
  const unit = range <= 3 ? "week" : "month";
  const sel = bar !== null && view.buckets[bar] ? view.buckets[bar] : null;
  const selSum = sel ? sumOf(focus ? sel.rows.filter((r) => view.keyOf(r) === focus) : sel.rows) : 0;

  // Folder tabs behind the list: the next categories' colours, grey while one is focused.
  const tabColors = view.tiles.filter((t) => t.key !== (focus ?? view.tiles[0]?.key)).slice(0, 3).map((t) => t.style.color);
  const layers = [0, 1, 2].map((i) => focus ? `var(--fold-${i + 1})` : tabColors[2 - i] ?? FALLBACK_TABS[i]);

  // List grouped by day
  const groups: { day: string; items: Receipt[] }[] = [];
  view.focused.forEach((r) => {
    const d = dayIso(r);
    const last = groups[groups.length - 1];
    if (last && last.day === d) last.items.push(r);
    else groups.push({ day: d, items: [r] });
  });
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const yd = new Date(now); yd.setDate(now.getDate() - 1);
  const yesterdayIso = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
  const dayLabel = (iso: string) => iso === todayIso ? "Today" : iso === yesterdayIso ? "Yesterday"
    : new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

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

      <div className="flex flex-1 flex-col gap-5 px-5 pb-36 pt-[max(24px,env(safe-area-inset-top))] md:px-10 md:pb-16 md:pt-10 lg:px-12">
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
          <div className="flex flex-col gap-5 md:grid md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:items-start md:gap-x-10 lg:gap-x-12">
            {/* Left (or top on phones): range, total, chart, tiles */}
            <div className="flex flex-col gap-5 md:sticky md:top-8">
              {/* Range picker with a sliding pill */}
              <div role="tablist" aria-label="Time range" className="relative grid grid-cols-4 rounded-2xl bg-surface p-1">
                <span aria-hidden="true"
                  className="ease-ios absolute bottom-1 left-1 top-1 w-[calc((100%-8px)/4)] rounded-xl bg-fg transition-transform duration-[400ms]"
                  style={{ transform: `translateX(${RANGES.findIndex((r) => r.v === range) * 100}%)` }} />
                {RANGES.map((r) => (
                  <button key={r.v} type="button" role="tab" aria-selected={r.v === range} aria-label={r.long}
                    onClick={() => r.v !== range && change({ range: r.v, offset: 0 })}
                    className={`relative h-[38px] text-sm font-semibold transition-colors duration-300 ${r.v === range ? "text-bg" : "text-muted"}`}>
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Period with previous / next */}
              <div className="-my-1 flex items-center justify-between">
                <button type="button" onClick={() => canPrev && change({ offset: offset + 1 })} disabled={!canPrev} aria-label="Earlier period"
                  className="tap flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-25">
                  <Icon d={ICONS.back} size={18} stroke={2.2} />
                </button>
                <p key={`p${tick}`} aria-live="polite" className="anim-pop text-[15px] font-semibold">
                  {view.label}
                  {offset === 0 && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 align-[2px] text-[11px] font-semibold text-ink">Now</span>}
                </p>
                <button type="button" onClick={() => canNext && change({ offset: offset - 1 })} disabled={!canNext} aria-label="Later period"
                  className="tap flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-25">
                  <Icon d={ICONS.chevron} size={18} stroke={2.2} />
                </button>
              </div>

              {/* Total, counting up */}
              <section aria-label="Total spent">
                <p className="flex items-center gap-2 text-sm text-muted">
                  <span className="h-2.5 w-2.5 rounded-full transition-colors duration-300" style={{ background: focusColor ?? "var(--text)" }} />
                  {focusTile ? focusTile.fullName : "All spending"}
                </p>
                <p className="mt-1.5 text-[54px] font-semibold leading-none tracking-[-0.05em] tabular-nums">
                  <span className="mr-0.5 align-[17px] text-[28px] font-medium tracking-normal">฿</span>{main}
                  <span className="text-[26px] tracking-normal text-muted">{dec}</span>
                </p>
                <p className="mt-2.5 text-[13px] text-muted">
                  {view.focused.length} receipt{view.focused.length === 1 ? "" : "s"}
                  {focus && view.total > 0 && ` · ${Math.round((view.focusedTotal / view.total) * 100)}% of this period`}
                </p>
              </section>

              {/* Spending chart */}
              <section aria-labelledby="chart-title" className="rounded-3xl bg-surface px-4 pb-3 pt-4">
                <div className="flex min-h-5 items-baseline justify-between gap-3">
                  <h2 id="chart-title" className="text-[15px] font-semibold">Spending by {unit}</h2>
                  <p key={`i${tick}-${bar}`} aria-live="polite" className={`anim-pop text-right text-[13px] tabular-nums ${sel ? "text-fg" : "text-muted"}`}>
                    {sel ? `${sel.title} · ฿${money(selSum)}` : `Avg ฿${money(view.focusedTotal / view.buckets.length)} / ${unit}`}
                  </p>
                </div>
                <div className="mt-3.5 flex h-[124px] items-end border-b border-line" style={{ gap: view.buckets.length > 6 ? 5 : 10 }}>
                  {view.buckets.map((b, i) => {
                    const all = sumOf(b.rows);
                    const part = focus ? sumOf(b.rows.filter((r) => view.keyOf(r) === focus)) : all;
                    const h0 = all === 0 ? 3 : Math.round((part / view.max) * CHART_H);
                    const h1 = Math.round(((all - part) / view.max) * CHART_H);
                    return (
                      <button key={`${tick}-${i}`} type="button" onClick={() => setBar(bar === i ? null : i)}
                        aria-pressed={bar === i} aria-label={`${b.title}, ${money(part)} baht`}
                        className="flex h-[124px] min-w-0 flex-1 items-end justify-center transition-opacity duration-300"
                        style={{ opacity: bar === null || bar === i ? 1 : 0.35 }}>
                        <span className="anim-grow flex w-full max-w-9 flex-col-reverse gap-0.5" style={{ animationDelay: `${i * 28}ms` }}>
                          <span className="ease-ios block transition-[height,background-color] duration-500"
                            style={{ height: h0, background: all === 0 ? "var(--surface2)" : focusColor ?? "var(--text)", borderRadius: h1 > 0 ? 0 : "4px 4px 0 0" }} />
                          <span className="ease-ios block rounded-t bg-surface2 transition-[height] duration-500" style={{ height: h1 }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex" style={{ gap: view.buckets.length > 6 ? 5 : 10 }} aria-hidden="true">
                  {view.buckets.map((b, i) => (
                    <span key={i} className="min-w-0 flex-1 whitespace-nowrap text-center text-[11px] text-muted">{b.label}</span>
                  ))}
                </div>
              </section>

              {/* Category tiles: tap to focus, the rest fade to grey */}
              {view.tiles.length > 0 && (
                <div className="grid grid-cols-[1.2fr_1fr] gap-2" style={{ gridTemplateRows: view.rows }}>
                  {view.tiles.map((t, i) => {
                    const on = !focus || focus === t.key;
                    return (
                      <button key={t.key} type="button"
                        onClick={() => change({ focus: focus === t.key ? null : t.key })}
                        aria-pressed={focus === t.key}
                        aria-label={`${t.fullName}, ${t.pct} percent, ฿${money(t.sum)}. ${focus === t.key ? "Show all categories" : "Focus on this category"}`}
                        className={`anim-rise ease-ios relative flex overflow-hidden rounded-[22px] px-3.5 py-3 text-left transition-[transform,background-color,color] duration-[400ms] active:scale-95 ${t.small ? "flex-row items-center justify-between" : "flex-col items-start justify-between"}`}
                        style={{
                          gridArea: t.area, animationDelay: `${i * 50}ms`,
                          background: on ? t.style.color : "var(--tile-off)",
                          color: on ? "#0E0E0F" : "var(--tile-off-text)",
                          transform: focus === t.key ? "scale(1.03)" : focus ? "scale(0.97)" : undefined,
                        }}>
                        {!t.small && <Icon d={t.style.icon} size={18} className="absolute right-3 top-3 opacity-55" />}
                        <span className={`font-semibold leading-none tracking-[-0.04em] tabular-nums ${t.big ? "text-[44px]" : t.small ? "text-lg" : "text-[28px]"}`}>{t.pct}%</span>
                        <span className="text-[13px] font-medium">{t.style.short}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right (or bottom on phones): the receipt folder */}
            <section aria-labelledby="list-title" className="relative pt-6">
              {layers.map((c, i) => (
                <Folder key={`${tick}-l${i}`} color={c} tab={`${56 - i * 4}%`} bodyClass="h-12"
                  className="anim-lift absolute inset-x-0" style={{ top: i * 8, animationDelay: `${i * 50}ms` }} />
              ))}
              <Folder key={`${tick}-front`} color="var(--surface)" tab="42%" className="anim-lift relative" style={{ animationDelay: "150ms" }}
                bodyClass="px-1.5 pb-2 pt-1">
                <div className="absolute left-4 top-[3px] flex h-6 max-w-[38%] items-center">
                  <h2 id="list-title" className="truncate text-base font-semibold tracking-[-0.01em]">
                    {focusTile ? focusTile.style.short : "Receipts"}
                  </h2>
                </div>
                {focus && (
                  <button type="button" onClick={() => change({ focus: null })}
                    className="tap anim-pop absolute right-3 top-8 flex h-[30px] items-center gap-1.5 rounded-full bg-surface2 pl-3 pr-2.5 text-[13px] font-medium">
                    Show all <Icon d={ICONS.close} size={13} stroke={2.2} />
                  </button>
                )}
                <div className={focus ? "pt-9" : "pt-2"}>
                  {receipts.length === 0 ? (
                    <div className="px-3 pb-5 pt-2">
                      <p className="text-[15px] font-medium">Scan your first receipt</p>
                      <p className="mt-1 text-sm text-muted">Take a photo and we&apos;ll fill in the shop, date and total for you.</p>
                    </div>
                  ) : groups.length === 0 ? (
                    <p className="px-3 pb-5 pt-2 text-[15px] text-muted">No receipts in this period. Try a longer range.</p>
                  ) : groups.map((g, gi) => (
                    <div key={`${tick}-${g.day}`}>
                      <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted">{dayLabel(g.day)}</p>
                      <ul>
                        {g.items.map((r, i) => {
                          const cat = r.category_id ? categories[r.category_id] : undefined;
                          const style = categoryStyle(cat?.name, cat?.color);
                          return (
                            <li key={r.id}>
                              <Link href={`/receipts/${r.id}`}
                                className={`tap press anim-rise flex items-center gap-3 rounded-[18px] p-2.5 ${highlight.includes(r.id) ? "anim-flash" : ""}`}
                                style={{ animationDelay: `${120 + Math.min(gi * 2 + i, 8) * 40}ms` }}>
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
              </Folder>
            </section>
          </div>
        )}
      </div>

      {/* Phone: floating Scan button that shrinks to an icon while scrolling */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-[max(28px,env(safe-area-inset-bottom))] md:hidden">
        <Link href="/scan" aria-label="Scan receipt"
          className="tap ease-ios pointer-events-auto flex h-[60px] items-center justify-center overflow-hidden whitespace-nowrap rounded-full bg-fg font-semibold text-bg shadow-[0_12px_32px_rgba(0,0,0,0.28)] transition-[width] duration-[400ms]"
          style={{ width: compact ? 60 : 186 }}>
          <Icon d={ICONS.camera} size={22} stroke={1.9} className="shrink-0" />
          <span className="ease-ios inline-block overflow-hidden text-base transition-[max-width,opacity,margin] duration-[400ms]"
            style={{ maxWidth: compact ? 0 : 120, opacity: compact ? 0 : 1, marginLeft: compact ? 0 : 10 }}>
            Scan receipt
          </span>
        </Link>
      </div>
    </div>
  );
}
