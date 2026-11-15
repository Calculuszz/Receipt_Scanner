"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import type { Receipt } from "@/lib/types";
import { ICONS, categoryStyle, money, moneyParts, shortDate, takeFlash, type Flash } from "@/lib/ui";
import { Icon, RoundButton, Spinner, ThemeToggle, Toast } from "@/components/ui";

type CategoryInfo = { id: string; name: string; color: string | null };

// Tile layouts for 1–5 categories: [grid-area per tile], grid rows.
const LAYOUTS: Record<number, { areas: string[]; rows: string }> = {
  1: { areas: ["1 / 1 / 2 / 3"], rows: "96px" },
  2: { areas: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3"], rows: "96px" },
  3: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"], rows: "88px 88px" },
  4: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "3 / 1 / 4 / 3"], rows: "88px 88px 58px" },
  5: { areas: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "3 / 1 / 4 / 2", "3 / 2 / 4 / 3"], rows: "88px 88px 58px" },
};

function monthKey(r: Receipt) {
  return (r.receipt_date ?? r.created_at.slice(0, 10)).slice(0, 7);
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
        setError("We couldn't load your receipts. Pull to refresh or try again in a moment.");
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlash(takeFlash());
    load();
  }, [load]);

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const view = useMemo(() => {
    const month = receipts.filter((r) => monthKey(r) === thisMonth);
    const total = month.reduce((s, r) => s + Number(r.total), 0);
    const sums = new Map<string, number>();
    month.forEach((r) => {
      const key = r.category_id ?? "none";
      sums.set(key, (sums.get(key) ?? 0) + Number(r.total));
    });
    const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const layout = LAYOUTS[ranked.length];
    const tiles = ranked.map(([key, sum], i) => {
      const cat = key === "none" ? undefined : categories[key];
      const style = categoryStyle(cat?.name, cat?.color);
      const pct = total > 0 ? Math.round((sum / total) * 100) : 0;
      return {
        key, pct, color: style.color, label: style.short, fullName: cat?.name ?? "No category",
        area: layout.areas[i], small: ranked.length >= 4 && i >= 3, big: i === 0 && ranked.length >= 3,
      };
    });
    const list = filter ? receipts.filter((r) => (r.category_id ?? "none") === filter) : receipts;
    const allTotal = receipts.reduce((s, r) => s + Number(r.total), 0);
    return { month, total, allTotal, tiles, rows: layout?.rows, list };
  }, [receipts, categories, filter, thisMonth]);

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

  const [main, dec] = moneyParts(view.total);
  const filterName = filter ? (filter === "none" ? "No category" : categories[filter]?.name ?? "Category") : null;

  return (
    <div className="flex min-h-screen flex-col">
      {flash && (
        <Toast
          text={flash.text}
          ms={flash.undoRow ? 4500 : 2600}
          actionLabel={flash.undoRow ? "Undo" : undefined}
          onAction={flash.undoRow ? () => undoDelete(flash.undoRow!) : undefined}
          onDone={() => setFlash(null)}
        />
      )}

      <div className="flex flex-1 flex-col gap-6 px-5 pb-36 pt-[max(28px,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium text-muted">{monthLabel}</p>
            <h1 className="mt-0.5 text-[30px] font-semibold tracking-[-0.03em]">Expenses</h1>
          </div>
          <div className="flex gap-2">
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
          <>
            <section aria-label="Spending this month" className="anim-fade">
              <p className="text-sm text-muted">Spent this month</p>
              <p className="mt-1.5 text-[52px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
                <span className="mr-0.5 align-[16px] text-[28px] font-medium">฿</span>{main}
                <span className="text-[26px] text-muted">{dec}</span>
              </p>
              <p className="mt-2.5 text-sm text-muted">
                {view.month.length} receipt{view.month.length === 1 ? "" : "s"} this month
                {receipts.length > view.month.length && ` · ฿${money(view.allTotal)} in total`}
              </p>
            </section>

            {view.tiles.length > 0 && (
              <div className="grid grid-cols-[1.2fr_1fr] gap-2" style={{ gridTemplateRows: view.rows }}>
                {view.tiles.map((t, i) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilter(filter === t.key ? null : t.key)}
                    aria-pressed={filter === t.key}
                    aria-label={`${t.fullName}, ${t.pct} percent of this month. ${filter === t.key ? "Show all receipts" : "Show only this category"}`}
                    className={`tap anim-rise flex rounded-[22px] px-3.5 py-3 text-left text-ink ${t.small ? "flex-row items-center justify-between" : "flex-col items-start justify-between"}`}
                    style={{ gridArea: t.area, background: t.color, opacity: filter && filter !== t.key ? 0.32 : 1, animationDelay: `${i * 50}ms` }}
                  >
                    <span className={`font-semibold leading-none tracking-[-0.04em] tabular-nums ${t.big ? "text-[46px]" : t.small ? "text-lg" : "text-[28px]"}`}>{t.pct}%</span>
                    <span className="text-[13px] font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
            )}

            <section className="relative pt-5" aria-labelledby="list-title">
              <div aria-hidden="true" className="absolute inset-x-7 top-0 h-20 rounded-[22px] bg-[#FFB34F]" />
              <div aria-hidden="true" className="absolute inset-x-3.5 top-[7px] h-20 rounded-[22px] bg-[#C38BFA]" />
              <div aria-hidden="true" className="absolute inset-x-0 top-3.5 h-20 rounded-[22px] bg-[#0EB6F2]" />
              <div className="relative rounded-3xl bg-surface px-1.5 pb-1.5 pt-2">
                <div className="flex min-h-8 items-center justify-between px-3 pb-1.5 pt-2.5">
                  <h2 id="list-title" className="text-[17px] font-semibold tracking-[-0.01em]">{filterName ?? "Recent"}</h2>
                  {filter && (
                    <button type="button" onClick={() => setFilter(null)}
                      className="tap flex h-8 items-center gap-1.5 rounded-2xl bg-surface2 px-3 text-[13px] font-medium">
                      Show all <Icon d={ICONS.close} size={14} stroke={2} />
                    </button>
                  )}
                </div>

                {receipts.length === 0 ? (
                  <div className="px-3 pb-6 pt-2">
                    <p className="text-[15px] font-medium">Scan your first receipt</p>
                    <p className="mt-1 text-sm text-muted">Take a photo and we&apos;ll fill in the shop, date and total for you.</p>
                  </div>
                ) : (
                  <ul>
                    {view.list.map((r, i) => {
                      const cat = r.category_id ? categories[r.category_id] : undefined;
                      const style = categoryStyle(cat?.name, cat?.color);
                      return (
                        <li key={r.id}>
                          <Link
                            href={`/receipts/${r.id}`}
                            className={`tap press anim-rise flex items-center gap-3 rounded-[18px] p-2.5 ${highlight.includes(r.id) ? "anim-flash" : ""}`}
                            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                          >
                            <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-ink" style={{ background: style.color }}>
                              <Icon d={style.icon} />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate text-[15px] font-medium">{r.shop_name || "Unknown shop"}</span>
                              <span className="text-[13px] text-muted">{shortDate(r.receipt_date)} · {cat?.name ?? "No category"}</span>
                            </span>
                            <span className="shrink-0 text-[15px] font-semibold tabular-nums">฿{money(Number(r.total))}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-[max(28px,env(safe-area-inset-bottom))]">
        <Link href="/scan"
          className="tap pointer-events-auto flex h-[60px] items-center gap-2.5 rounded-full bg-fg pl-[22px] pr-7 text-base font-semibold text-bg shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
          <Icon d={ICONS.camera} size={22} stroke={1.9} />
          Scan receipt
        </Link>
      </div>
    </div>
  );
}
