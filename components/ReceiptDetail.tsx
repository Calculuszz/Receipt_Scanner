"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase-browser";
import { validDate } from "@/lib/receipt-validation";
import { RECEIPTS_BUCKET, type Receipt } from "@/lib/types";
import { ICONS, categoryForOther, categoryStyle, isDefaultOther, longDate, moneyParts, scanCheck, setFlash, todayIso } from "@/lib/ui";
import { Icon, Spinner, Toast } from "@/components/ui";
import { STATUS, asStatus, loadMe, memberName, type Me } from "@/lib/admin";
import { SendBackSheet } from "@/components/ReviewQueue";
import type { ClubEvent } from "@/lib/types";

type CategoryInfo = { id: string; name: string; color: string; user_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOTAL = 99999999.99;
const SIGNED_URL_SECONDS = 60 * 60;

function formatDateTime(ts: string) {
  return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-[15px] ${last ? "" : "border-b border-line"}`}>
      <dt className="shrink-0 text-[15px] text-muted">{label}</dt>
      <dd className="m-0 break-words text-right text-[15px]">{children}</dd>
    </div>
  );
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

  const [me, setMe] = useState<Me | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [editEvent, setEditEvent] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [sendBack, setSendBack] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editCat, setEditCat] = useState("");
  const [otherName, setOtherName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");

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
        const [r, c, who, ev] = await Promise.all([
          supabase.from("receipts").select("*").eq("id", id).maybeSingle(),
          supabase.from("categories").select("id, name, color, user_id").order("name"),
          loadMe(supabase),
          supabase.from("events").select("*").order("created_at", { ascending: false }),
        ]);
        if (cancelled) return;
        if (r.error) {
          setLoadError("We couldn't load this receipt. Try again in a moment.");
          return;
        }
        // RLS hides other users' receipts, so "not yours" also comes back empty.
        if (!r.data) {
          setNotFound(true);
          return;
        }
        setReceipt(r.data);
        // Admins can read every member's categories; only offer the defaults plus the owner's own.
        setCategories((c.data ?? []).filter((cat) => cat.user_id === null || cat.user_id === r.data.user_id));
        setMe(who);
        setEvents((ev.data ?? []) as ClubEvent[]);
        if (who?.id !== r.data.user_id) {
          const { data: owner } = await supabase.from("profiles").select("display_name, email").eq("id", r.data.user_id).maybeSingle();
          if (cancelled) return;
          setOwnerName(memberName(owner ?? undefined));
        }

        if (r.data.image_path) {
          const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(r.data.image_path, SIGNED_URL_SECONDS);
          if (cancelled) return;
          if (error || !data) setImageError("We couldn't load the photo.");
          else setImageUrl(data.signedUrl);
        }
      } catch {
        if (!cancelled) setLoadError("Can't reach the server. Check your internet and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  function startEdit() {
    if (!receipt) return;
    setEditCat(receipt.category_id ?? "");
    setEditEvent(receipt.event_id ?? "");
    setOtherName("");
    setFormError("");
    setConfirmDelete(false);
    setEditing(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receipt || saving) return;
    const data = new FormData(event.currentTarget);
    const shopName = String(data.get("shopName") ?? "").trim();
    const dateRaw = String(data.get("receiptDate") ?? "");
    const total = Number(String(data.get("total") ?? "").replace(/,/g, ""));
    const note = String(data.get("note") ?? "").trim();

    if (!Number.isFinite(total) || total <= 0 || total > MAX_TOTAL) return setFormError("Enter the amount paid, more than ฿0.");
    if (dateRaw && !validDate(dateRaw)) return setFormError("Enter a real date, or leave it empty.");
    if (dateRaw && dateRaw > todayIso()) return setFormError("That date is in the future. Check the year on the receipt.");
    if (editCat && !categories.some((c) => c.id === editCat)) return setFormError("Choose a category from the list.");

    setSaving(true);
    setFormError("");
    let categoryId = editCat;
    if (otherName.trim() && isDefaultOther(categories.find((c) => c.id === editCat))) {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("Please log in again.");
        const { id: newId, created } = await categoryForOther(supabase, auth.user.id, otherName, categories);
        if (created) setCategories((list) => [...list, created]);
        categoryId = newId;
      } catch (err) {
        setSaving(false);
        return setFormError(err instanceof Error ? err.message : "Couldn't add that category.");
      }
    }
    const { data: updated, error } = await supabase
      .from("receipts")
      .update({
        shop_name: shopName || null,
        receipt_date: dateRaw || null,
        total: Math.round(total * 100) / 100,
        category_id: categoryId || null,
        note: note || null,
        event_id: editEvent || null,
      })
      .eq("id", receipt.id)
      .select()
      .maybeSingle();
    setSaving(false);

    // The database explains locks ("already approved..."), so show its message when there is one.
    if (error) return setFormError(error.code === "42501" ? error.message : "Couldn't save your changes. Try again.");
    if (!updated) return setFormError("This receipt no longer exists. Go back to your expenses.");
    const wasSentBack = receipt.status === "rejected";
    setReceipt(updated);
    setEditing(false);
    setToast(wasSentBack ? "Fixed and sent to the treasurer again" : "Changes saved");
  }

  /** Treasurer: approve, send back, mark paid, or undo paid. The trigger checks the move is allowed. */
  async function review(status: "approved" | "rejected" | "paid", note?: string) {
    if (!receipt || reviewing) return;
    setReviewing(true);
    const { data, error } = await supabase.from("receipts")
      .update(note !== undefined ? { status, review_note: note } : { status })
      .eq("id", receipt.id).select().maybeSingle();
    setReviewing(false);
    if (error || !data) { setToast(error?.message ?? "Couldn't update it. Try again."); return; }
    setReceipt(data);
    setToast(status === "approved" ? "Approved. They were notified." : status === "paid" ? "Marked as paid back." : `Sent back to ${ownerName || "the member"}.`);
  }

  async function handleDelete() {
    if (!receipt || deleting) return;
    setDeleting(true);
    setDeleteError("");
    // Several receipts can share one source file (multi-receipt PDF), so the file is kept.
    const { error } = await supabase.from("receipts").delete().eq("id", receipt.id);
    if (error) {
      setDeleting(false);
      setDeleteError("Couldn't delete it. Try again.");
      return;
    }
    setFlash({ text: "Receipt deleted", undoRow: receipt, month: (receipt.receipt_date ?? receipt.created_at.slice(0, 10)).slice(0, 7) });
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted" role="status">
        <Spinner size={28} /><span className="sr-only">Loading receipt</span>
      </div>
    );
  }

  if (notFound || loadError || !receipt) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-xl font-semibold">{notFound ? "Receipt not found" : "Couldn't load this receipt"}</p>
        <p className="text-[15px] text-muted">{notFound ? "It may have been deleted, or it belongs to another account." : loadError}</p>
        <Link href="/" className="tap mt-3 flex h-12 items-center rounded-full bg-surface px-5 text-[15px] font-medium">Back to expenses</Link>
      </div>
    );
  }

  const category = categories.find((c) => c.id === receipt.category_id);
  const style = categoryStyle(category?.name, category?.color);
  const [main, dec] = moneyParts(Number(receipt.total));
  const check = scanCheck(receipt.ai_confidence);
  const isPdf = receipt.image_path?.toLowerCase().endsWith(".pdf");
  const status = asStatus(receipt.status);
  const st = STATUS[status];
  const mine = me?.id === receipt.user_id;
  const open = status === "pending" || status === "rejected";
  // Members edit only while it's being checked or was sent back; the treasurer may edit their own any time.
  const canEdit = mine && !!me?.active && (open || !!me?.admin);
  const reviewer = !!me?.admin && !mine;
  const event = events.find((e) => e.id === receipt.event_id);

  return (
    // Phone: coloured header on top. Tablet/desktop: header card on the left, details on the right.
    <div className="anim-push mx-auto min-h-screen w-full max-w-md pb-10 md:grid md:max-w-5xl md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:items-start md:gap-8 md:px-10 md:pt-10 lg:gap-12">
      {toast && <Toast text={toast} onDone={() => setToast("")} />}

      {/* Hero in the category colour */}
      <header className="rounded-b-[34px] px-5 pb-6 pt-[max(20px,env(safe-area-inset-top))] text-ink md:sticky md:top-10 md:rounded-[34px] md:p-7" style={{ background: style.color }}>
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Back to expenses" className="tap flex h-11 w-11 items-center justify-center rounded-full bg-black/10">
            <Icon d={ICONS.back} stroke={2.2} />
          </Link>
          {!canEdit ? (
            <span className="flex h-11 items-center rounded-full bg-black/10 px-[18px] text-[13px] font-semibold">{mine ? "Locked" : "View only"}</span>
          ) : !editing && (
            <button type="button" onClick={startEdit} className="tap h-11 rounded-full bg-black/10 px-[18px] text-[15px] font-semibold">Edit</button>
          )}
        </div>
        <span className="mt-7 inline-flex h-[30px] items-center gap-1.5 rounded-full bg-black/10 pl-2 pr-3 text-[13px] font-medium">
          <Icon d={style.icon} size={16} stroke={1.9} />
          {category?.name ?? "No category"}
        </span>
        <h1 className="mt-3.5 text-xl font-medium tracking-[-0.01em]">{receipt.shop_name || "Unknown shop"}</h1>
        <p className="mt-1.5 text-[54px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
          <span className="mr-0.5 align-[16px] text-[30px] font-medium">฿</span>{main}
          <span className="text-[28px] opacity-55">{dec}</span>
        </p>
        <p className="mt-2 text-sm text-black/70">
          {receipt.receipt_date ? `Bought ${longDate(receipt.receipt_date)}` : "No date on the receipt"}
          {!mine && ownerName ? ` · by ${ownerName}` : ""}
        </p>
      </header>

      <div className="flex flex-col gap-3 px-5 pt-[18px] md:px-0 md:pt-0">
        {/* Review status, with the treasurer's reason when it was sent back */}
        {!editing && (
          <section aria-label="Review status" className="anim-rise rounded-[20px] p-4" style={{ background: st.bg }}>
            <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: st.fg }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: st.dot }} />{st.label}
            </p>
            {status === "rejected" && receipt.review_note && (
              <p className="mt-2 rounded-xl bg-bg/70 px-3 py-2 text-[15px] leading-snug">“{receipt.review_note}”</p>
            )}
            {status === "paid" && receipt.paid_at && <p className="mt-1 text-[13px] text-muted">On {longDate(receipt.paid_at.slice(0, 10))}</p>}
            {mine && status === "rejected" && (
              <button type="button" onClick={startEdit}
                className="tap mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-fg text-[15px] font-semibold text-bg">
                <Icon d={ICONS.pencil} size={16} /> Fix it and send again
              </button>
            )}
            {mine && !open && !me?.admin && (
              <p className="mt-1 text-[13px] text-muted">It can&apos;t be changed now. Ask the treasurer if something is wrong.</p>
            )}
            {reviewer && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(status === "pending" || status === "approved") && (
                  <button type="button" disabled={reviewing} onClick={() => setSendBack(true)}
                    className="tap h-10 flex-1 rounded-2xl bg-bg/70 px-3 text-[14px] font-medium">Send back</button>
                )}
                {(status === "pending" || status === "rejected") && (
                  <button type="button" disabled={reviewing} onClick={() => void review("approved")}
                    className="tap flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-brand px-3 text-[14px] font-semibold text-ink">
                    {reviewing ? <Spinner /> : <Icon d={ICONS.check} size={16} stroke={2.4} />} {status === "rejected" ? "Approve anyway" : "Approve"}
                  </button>
                )}
                {status === "approved" && (
                  <button type="button" disabled={reviewing} onClick={() => void review("paid")}
                    className="tap flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-fg px-3 text-[14px] font-semibold text-bg">
                    {reviewing && <Spinner />} Mark paid back
                  </button>
                )}
                {status === "paid" && (
                  <button type="button" disabled={reviewing} onClick={() => void review("approved")}
                    className="tap h-10 flex-1 rounded-2xl bg-bg/70 px-3 text-[14px] font-medium">Undo paid</button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Photo / original file */}
        {imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="tap flex items-center gap-3.5 rounded-[20px] bg-surface p-3">
            {isPdf ? (
              <span className="flex h-[70px] w-[52px] shrink-0 items-center justify-center rounded-md bg-surface2 text-muted"><Icon d={ICONS.file} size={24} /></span>
            ) : (
              // Signed URLs change every load, so a plain img is simpler than next/image here
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="h-[70px] w-[52px] shrink-0 rounded-md object-cover md:h-[112px] md:w-[84px]" />
            )}
            <span className="flex-1">
              <span className="block text-[15px] font-medium">{isPdf ? "Original PDF" : "Receipt photo"}</span>
              <span className="mt-0.5 block text-[13px] text-muted">Tap to open full size</span>
            </span>
            <Icon d={ICONS.chevron} size={18} stroke={2} className="text-muted" />
          </a>
        ) : (
          <p className="rounded-[20px] bg-surface p-4 text-[15px] text-muted">{imageError || "No photo saved for this receipt."}</p>
        )}

        {editing ? (
          <form onSubmit={handleSave} onChange={() => setFormError("")} className="anim-rise flex flex-col gap-3">
            <label className="field-card block rounded-[20px] bg-surface p-4 transition-shadow">
              <span className="block text-[13px] text-muted">Total paid</span>
              <span className="mt-1 flex items-baseline gap-1">
                <span className="text-[30px] font-medium">฿</span>
                <input name="total" inputMode="decimal" required defaultValue={Number(receipt.total).toFixed(2)} aria-label="Total in baht"
                  className="min-w-0 flex-1 bg-transparent text-[40px] font-semibold tracking-[-0.03em] tabular-nums outline-none" />
              </span>
            </label>
            <div className="field-card rounded-[20px] bg-surface px-4 transition-shadow">
              <label className="flex min-h-[52px] items-center gap-3 border-b border-line">
                <span className="w-16 shrink-0 text-[15px]">Shop</span>
                <input name="shopName" defaultValue={receipt.shop_name ?? ""} placeholder="Shop name"
                  className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none placeholder:text-muted" />
              </label>
              <label className="flex min-h-[52px] items-center gap-3 border-b border-line">
                <span className="w-16 shrink-0 text-[15px]">Date</span>
                <input name="receiptDate" type="date" defaultValue={receipt.receipt_date ?? ""}
                  className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none" />
              </label>
              <label className="flex min-h-[52px] items-center gap-3">
                <span className="w-16 shrink-0 text-[15px]">Note</span>
                <input name="note" defaultValue={receipt.note ?? ""} placeholder="Add a note"
                  className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none placeholder:text-muted" />
              </label>
            </div>
            {events.some((e) => !e.archived || e.id === receipt.event_id) && (
              <label className="field-card flex min-h-[52px] items-center gap-3 rounded-[20px] bg-surface px-4">
                <span className="w-16 shrink-0 text-[15px]">Event</span>
                <select value={editEvent} onChange={(e) => setEditEvent(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none">
                  <option value="">No event</option>
                  {events.filter((e) => !e.archived || e.id === receipt.event_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
            )}
            <fieldset>
              <legend className="mx-1 mb-2.5 text-[13px] text-muted">Category</legend>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const s = categoryStyle(c.name, c.color);
                  const on = editCat === c.id;
                  return (
                    <button key={c.id} type="button" aria-pressed={on} onClick={() => setEditCat(on ? "" : c.id)}
                      className={`tap flex h-10 items-center gap-2 rounded-full pl-2.5 pr-3.5 text-sm font-medium ${on ? "text-ink" : "bg-surface"}`}
                      style={on ? { background: s.color } : undefined}>
                      <span className="h-3 w-3 rounded-full" style={{ background: s.color, boxShadow: on ? "inset 0 0 0 2px rgba(14,14,15,0.55)" : undefined }} />
                      {c.name}{c.user_id ? " (personal)" : ""}
                    </button>
                  );
                })}
              </div>
              {isDefaultOther(categories.find((c) => c.id === editCat)) && (
                <label className="field-card anim-rise mt-3 flex min-h-[52px] items-center gap-3 rounded-[20px] bg-surface px-4 transition-shadow">
                  <span className="w-16 shrink-0 text-[15px]">Name it</span>
                  <input value={otherName} onChange={(e) => setOtherName(e.target.value)} maxLength={40} autoFocus
                    placeholder="Club T-shirts" className="min-w-0 flex-1 bg-transparent text-right text-[15px] outline-none placeholder:text-muted" />
                </label>
              )}
            </fieldset>
            {formError && <p role="alert" className="anim-rise mx-1 text-sm text-danger">{formError}</p>}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button type="button" disabled={saving} onClick={() => setEditing(false)}
                className="tap h-[52px] rounded-2xl bg-surface text-base font-medium">Cancel</button>
              <button type="submit" disabled={saving}
                className="tap flex h-[52px] items-center justify-center gap-2 rounded-2xl bg-brand text-base font-semibold text-ink">
                {saving && <Spinner />}{saving ? "Saving…" : status === "rejected" && mine && !me?.admin ? "Save and send again" : "Save changes"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <dl className="m-0 rounded-[20px] bg-surface px-4">
              <Row label="Date">{longDate(receipt.receipt_date)}</Row>
              <Row label="Category">{category?.name ?? "No category"}</Row>
              {event && <Row label="Event">{event.name}</Row>}
              <Row label="Note" last={!check}>{receipt.note || "No note"}</Row>
              {check && (
                <Row label="Scan check" last>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: check.dot }} />{check.text}
                  </span>
                </Row>
              )}
            </dl>
            {canEdit && check && check.text !== "Read clearly" && (
              <p className="mx-1 text-[13px] leading-snug text-muted">Check the shop, date and total against the photo. Tap Edit to fix anything.</p>
            )}
            {!mine ? (
              <p className="mx-1 text-[13px] leading-snug text-muted">This receipt belongs to {ownerName || "another member"}. Only they can edit or delete it.</p>
            ) : canEdit && (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="tap h-[52px] rounded-2xl bg-surface text-base font-medium text-danger">Delete receipt</button>
            )}
            <p className="mt-1 text-center text-xs text-muted">
              Saved {formatDateTime(receipt.created_at)}
              {receipt.updated_at !== receipt.created_at ? ` · Edited ${formatDateTime(receipt.updated_at)}` : ""}
            </p>
          </>
        )}
      </div>

      {sendBack && (
        <SendBackSheet receipt={receipt} who={ownerName || "the member"} onClose={() => setSendBack(false)}
          onSend={async (note) => { setSendBack(false); await review("rejected", note); }} />
      )}

      {/* iOS-style action sheet */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40">
          <div className="anim-dim absolute inset-0 bg-black/40" onClick={() => !deleting && setConfirmDelete(false)} />
          <div role="dialog" aria-modal="true" aria-labelledby="delete-title"
            className="anim-sheet absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-md flex-col gap-2 px-2.5 pb-[max(30px,env(safe-area-inset-bottom))]">
            <div className="overflow-hidden rounded-[22px] bg-surface text-center">
              <div className="px-5 pb-3.5 pt-[18px]">
                <p id="delete-title" className="text-[15px] font-semibold">Delete this receipt?</p>
                <p className="mt-1 text-[13px] leading-snug text-muted">It will be removed from your expenses. You can undo right after.</p>
                {deleteError && <p role="alert" className="mt-2 text-[13px] text-danger">{deleteError}</p>}
              </div>
              <button type="button" onClick={handleDelete} disabled={deleting}
                className="press flex h-14 w-full items-center justify-center gap-2 border-t border-line text-[17px] font-semibold text-danger">
                {deleting && <Spinner />}{deleting ? "Deleting…" : "Delete receipt"}
              </button>
            </div>
            <button type="button" autoFocus onClick={() => setConfirmDelete(false)} disabled={deleting}
              className="tap h-14 rounded-[22px] bg-surface text-[17px] font-semibold">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
