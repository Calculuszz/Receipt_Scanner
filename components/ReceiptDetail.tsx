"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { validDate } from "@/lib/receipt-validation";
import { RECEIPTS_BUCKET, type Receipt } from "@/lib/types";

type CategoryInfo = { id: string; name: string; color: string; user_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOTAL = 99999999.99;
const SIGNED_URL_SECONDS = 60 * 60;

const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });

function formatDate(d: string | null) {
  if (!d) return "No date";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Turn Gemini's 0–1 confidence into plain words for non-technical users.
function describeScan(confidence: number | null) {
  if (confidence === null) return null;
  if (confidence >= 0.8) return { text: "Read clearly", warn: false };
  if (confidence >= 0.5) return { text: "Partly unclear. Check the details against the photo.", warn: true };
  return { text: "Hard to read. Check every field against the photo.", warn: true };
}

function formatDateTime(ts: string) {
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReceiptDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // A non-UUID id would make Postgres throw; treat it as "not found" instead.
      if (!UUID.test(id)) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      try {
        const [r, c] = await Promise.all([
          supabase.from("receipts").select("*").eq("id", id).maybeSingle(),
          supabase.from("categories").select("id, name, color, user_id").order("name"),
        ]);
        if (cancelled) return;
        if (r.error) {
          setLoadError(r.error.message);
          return;
        }
        // RLS hides other users' receipts, so "not yours" also comes back empty.
        if (!r.data) {
          setNotFound(true);
          return;
        }
        setReceipt(r.data);
        setCategories(c.data ?? []);

        if (r.data.image_path) {
          const { data, error } = await supabase.storage
            .from(RECEIPTS_BUCKET)
            .createSignedUrl(r.data.image_path, SIGNED_URL_SECONDS);
          if (cancelled) return;
          if (error || !data) setImageError("Could not load the receipt photo.");
          else setImageUrl(data.signedUrl);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load receipt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receipt || saving) return;
    const data = new FormData(event.currentTarget);
    const shopName = String(data.get("shopName") ?? "").trim();
    const dateRaw = String(data.get("receiptDate") ?? "");
    const total = Number(data.get("total"));
    const categoryId = String(data.get("category") ?? "");
    const note = String(data.get("note") ?? "").trim();

    if (!Number.isFinite(total) || total <= 0 || total > MAX_TOTAL) {
      setFormError("Enter a total greater than 0 and no more than 99,999,999.99.");
      return;
    }
    if (dateRaw && !validDate(dateRaw)) {
      setFormError("Enter a real date, or leave it empty.");
      return;
    }
    if (categoryId && !categories.some((c) => c.id === categoryId)) {
      setFormError("Choose a category from the list.");
      return;
    }

    setSaving(true);
    setFormError("");
    const { data: updated, error } = await supabase
      .from("receipts")
      .update({
        shop_name: shopName || null,
        receipt_date: dateRaw || null,
        total: Math.round(total * 100) / 100,
        category_id: categoryId || null,
        note: note || null,
      })
      .eq("id", receipt.id)
      .select()
      .maybeSingle();
    setSaving(false);

    if (error) {
      setFormError(`Couldn't save: ${error.message}`);
      return;
    }
    if (!updated) {
      setFormError("This receipt no longer exists. Go back to your expenses.");
      return;
    }
    setReceipt(updated);
    setEditing(false);
    setStatus("Changes saved");
  }

  async function handleDelete() {
    if (!receipt || deleting) return;
    setDeleting(true);
    setDeleteError("");

    // Delete the row first: if the photo removal then fails, the expense is
    // still gone and only an orphan file is left (see docs/receipt-cleanup.md).
    const { error } = await supabase.from("receipts").delete().eq("id", receipt.id);
    if (error) {
      setDeleting(false);
      setDeleteError(`Couldn't delete: ${error.message}`);
      return;
    }
    if (receipt.image_path) {
      await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.image_path]);
    }
    router.replace("/");
  }

  if (loading) return <p className="opacity-70">Loading receipt...</p>;

  if (notFound || loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-lg font-medium">
          {notFound ? "Receipt not found" : "Couldn't load this receipt"}
        </p>
        <p className="text-sm opacity-70">
          {notFound
            ? "It may have been deleted, or it belongs to another account."
            : loadError}
        </p>
        <Link href="/" className="rounded border px-4 py-2 text-sm">
          Back to expenses
        </Link>
      </div>
    );
  }

  if (!receipt) return null;

  const category = categories.find((c) => c.id === receipt.category_id);
  const scanQuality = describeScan(receipt.ai_confidence);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm opacity-70 hover:opacity-100">
          ← Back to expenses
        </Link>
        {!editing && (
          <button
            onClick={() => {
              setEditing(true);
              setStatus("");
              setFormError("");
              setConfirmDelete(false);
            }}
            className="rounded border px-3 py-1 text-sm"
          >
            Edit
          </button>
        )}
      </div>

      {/* Photo */}
      <div className="overflow-hidden rounded-lg border bg-zinc-50 dark:bg-zinc-900">
        {imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noopener noreferrer" title="Open full size">
            {/* Signed URLs change every load, so a plain img is simpler than next/image here */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`Receipt from ${receipt.shop_name || "unknown shop"}`}
              className="mx-auto max-h-[28rem] w-full object-contain"
            />
          </a>
        ) : (
          <p className="py-12 text-center text-sm opacity-70">
            {imageError || "No photo for this receipt"}
          </p>
        )}
      </div>

      {status && (
        <p role="status" className="rounded bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          {status}
        </p>
      )}

      {editing ? (
        <form onSubmit={handleSave} onChange={() => setFormError("")} className="flex flex-col gap-3 rounded-lg border p-4">
          <label className="flex flex-col gap-1 text-sm">
            Shop name
            <input
              name="shopName"
              defaultValue={receipt.shop_name ?? ""}
              placeholder="7-Eleven"
              className="rounded border px-3 py-2 text-base"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                name="receiptDate"
                type="date"
                defaultValue={receipt.receipt_date ?? ""}
                className="rounded border px-3 py-2 text-base"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Total (THB)
              <input
                name="total"
                type="number"
                required
                min="0.01"
                max={MAX_TOTAL}
                step="0.01"
                inputMode="decimal"
                defaultValue={receipt.total}
                className="rounded border px-3 py-2 text-base"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Category
            <select
              name="category"
              defaultValue={receipt.category_id ?? ""}
              className="rounded border bg-transparent px-3 py-2 text-base"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.user_id ? " (personal)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note
            <textarea
              name="note"
              rows={2}
              defaultValue={receipt.note ?? ""}
              placeholder="Snacks for club meeting"
              className="rounded border px-3 py-2 text-base"
            />
          </label>
          {formError && (
            <p role="alert" className="text-sm text-red-600">
              {formError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setFormError("");
              }}
              className="rounded border px-4 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* Summary */}
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="opacity-70">{receipt.shop_name || "Unknown shop"}</p>
            <p className="text-3xl font-bold">{money.format(Number(receipt.total))}</p>
            {category && (
              <span
                className="mt-1 rounded-full px-3 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: category.color }}
              >
                {category.name}
              </span>
            )}
          </div>

          {/* Details */}
          <dl className="divide-y rounded-lg border text-sm">
            <Row label="Date" value={formatDate(receipt.receipt_date)} />
            <Row label="Category" value={category?.name ?? "No category"} />
            <Row label="Note" value={receipt.note || "—"} />
            {scanQuality && (
              <Row label="Scan check" value={scanQuality.text} warn={scanQuality.warn} />
            )}
            <Row label="Saved" value={formatDateTime(receipt.created_at)} />
            {receipt.updated_at !== receipt.created_at && (
              <Row label="Last edited" value={formatDateTime(receipt.updated_at)} />
            )}
          </dl>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex flex-col gap-3 rounded-lg border border-red-300 p-4 dark:border-red-800">
              <p className="text-sm">
                Delete this receipt and its photo? This can&apos;t be undone.
              </p>
              {deleteError && (
                <p role="alert" className="text-sm text-red-600">
                  {deleteError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button
                  disabled={deleting}
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteError("");
                  }}
                  className="rounded border px-4 py-2 disabled:opacity-50"
                >
                  Keep it
                </button>
                <button
                  disabled={deleting}
                  onClick={handleDelete}
                  className="rounded bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setConfirmDelete(true);
                setStatus("");
              }}
              className="rounded border border-red-300 px-4 py-2 text-red-600 dark:border-red-800"
            >
              Delete receipt
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 opacity-70">{label}</dt>
      <dd className={`text-right break-words ${warn ? "text-amber-600" : ""}`}>{value}</dd>
    </div>
  );
}
