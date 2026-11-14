"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase-browser";
import type { Receipt } from "@/lib/types";

type CategoryInfo = { id: string; name: string; color: string | null };

const money = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
});

function formatDate(d: string | null) {
  if (!d) return "No date";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ExpenseList() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [categories, setCategories] = useState<Record<string, CategoryInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
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
          setError(r.error.message);
          return;
        }
        setReceipts((r.data ?? []) as Receipt[]);
        const map: Record<string, CategoryInfo> = {};
        (c.data ?? []).forEach((cat: CategoryInfo) => {
          map[cat.id] = cat;
        });
        setCategories(map);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load receipts");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p className="opacity-70">Loading receipts...</p>;
  if (error) return <p className="text-red-500">Could not load receipts: {error}</p>;

  const total = receipts.reduce((sum, r) => sum + Number(r.total), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <p className="text-sm opacity-70">Total spent</p>
        <p className="text-3xl font-bold">{money.format(total)}</p>
        <p className="text-sm opacity-70">
          {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
        </p>
      </div>

      <Link
        href="/scan"
        className="rounded bg-blue-600 px-4 py-3 text-center font-medium text-white"
      >
        + Scan receipt
      </Link>

      {receipts.length === 0 ? (
        <p className="py-8 text-center opacity-70">
          No receipts yet. Scan your first one!
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {receipts.map((r) => {
            const cat = r.category_id ? categories[r.category_id] : undefined;
            return (
              <li key={r.id}>
                <Link
                  href={`/receipts/${r.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.shop_name || "Unknown shop"}
                    </p>
                    <p className="text-sm opacity-70">
                      {formatDate(r.receipt_date)}
                      {cat ? ` · ${cat.name}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold">
                    {money.format(Number(r.total))}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}