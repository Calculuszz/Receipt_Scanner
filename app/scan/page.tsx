"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { normalizeDocument, scanWarning, type ScannedReceipt } from "@/lib/receipt-validation";
import { buildReceiptBatch, saveReceiptBatch, type ReceiptBatch, type ReceiptDraft } from "@/lib/receipt-batch";
import { prepareReceiptFile } from "@/lib/receipt-file";
import { ICONS, categoryForOther, isDefaultOther, longDate, money, setFlash, todayIso } from "@/lib/ui";
import { Icon, Spinner } from "@/components/ui";
import AuthGuard from "@/components/AuthGuard";

type Phase = "idle" | "preparing" | "uploading" | "scanning" | "reviewing" | "saving" | "cancelling";
type Category = { id: string; name: string; user_id: string | null };
type Source = { userId: string; path: string };
const labels: Partial<Record<Phase, string>> = {
  preparing: "Preparing your file…", uploading: "Uploading your file…", scanning: "Reading receipts…",
  saving: "Saving all receipts…", cancelling: "Removing unsaved file…",
};
const rowInput = "min-w-0 flex-1 bg-transparent text-right text-[15px] text-fg outline-none placeholder:text-muted";
const secondary = "tap flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-4 text-[15px] font-medium disabled:opacity-50";

function toDraft(receipt?: ScannedReceipt, categories: Category[] = []): ReceiptDraft {
  const category = categories.find((item) => item.name === receipt?.category && item.user_id === null)
    ?? categories.find((item) => item.name === receipt?.category);
  return {
    id: crypto.randomUUID(), shopName: receipt?.shop_name ?? "", date: receipt?.receipt_date ?? "",
    total: receipt?.total?.toString() ?? "", currency: receipt?.currency ?? null, confirmedThb: false,
    categoryId: category?.id ?? "", note: "", sourcePages: receipt?.source_pages ?? [], confidence: receipt?.confidence ?? null,
  };
}

function PdfReceiptPreview({ url, sourcePages, index }: { url: string; sourcePages: number[]; index: number }) {
  const [page, setPage] = useState(sourcePages[0]?.toString() ?? "");
  const pageNumber = Number(page);
  const validPage = Number.isSafeInteger(pageNumber) && pageNumber > 0;
  const pageUrl = validPage ? `${url}#page=${pageNumber}` : url;
  return (
    <div className="space-y-3 rounded-[20px] bg-surface p-4">
      <p className="text-[15px] font-medium">Original PDF</p>
      <p className="text-[13px] text-muted">{sourcePages.length ? `Found on page ${sourcePages.join(", ")}. Check it against the original.` : "We couldn't tell which page. Enter a page number or scroll the document."}</p>
      <label className="flex min-h-11 items-center gap-3 rounded-xl bg-surface2 px-3 text-[15px]">
        <span className="shrink-0">Page</span>
        <input type="number" min="1" step="1" inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} placeholder="All" className={rowInput} />
      </label>
      <iframe key={pageUrl} src={pageUrl} title={`PDF preview for receipt ${index + 1}`} className="h-80 w-full rounded-xl bg-white" />
      <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-[13px] font-medium underline">Open PDF{validPage ? ` at page ${pageNumber}` : ""} in a new tab</a>
    </div>
  );
}

type Client = ReturnType<typeof createClient>;

/** Draft id → "already saved?" hint, matched on the same total and date. */
async function findDuplicates(supabase: Client, drafts: ReceiptDraft[]): Promise<Record<string, string>> {
  const totals = [...new Set(drafts.map((d) => Number(d.total)).filter((n) => n > 0))];
  if (!totals.length) return {};
  const { data } = await supabase.from("receipts").select("shop_name, receipt_date, total, created_at").in("total", totals).limit(50);
  const out: Record<string, string> = {};
  for (const d of drafts) {
    const hit = (data ?? []).find((r) => Number(r.total) === Number(d.total) && (r.receipt_date ?? "") === (d.date ?? ""));
    if (hit) {
      out[d.id] = `You already saved a ฿${money(Number(hit.total))} receipt${hit.shop_name ? ` from ${hit.shop_name}` : ""}${hit.receipt_date ? ` dated ${longDate(hit.receipt_date)}` : ""}. Remove this one if it's the same.`;
    }
  }
  return out;
}

export default function ScanPage() {
  return (
    <AuthGuard>
      <ScanScreen />
    </AuthGuard>
  );
}

function ScanScreen() {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const cameraRequest = useRef(0);
  const [cameraOpen, setCameraOpen] = useState(true);
  const [cameraStarting, setCameraStarting] = useState(true);
  const lock = useRef(false);
  const source = useRef<Source | null>(null);
  const pending = useRef<{ userId: string; rows: ReceiptBatch } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ReceiptDraft[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [frozen, setFrozen] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  // Per-draft extras: the name typed for "Other", and "already saved?" hints.
  const [otherNames, setOtherNames] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<Record<string, string>>({});
  const busy = phase !== "idle" && phase !== "reviewing";

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    const requestRef = cameraRequest;
    const streamRef = cameraStream;
    return () => {
      requestRef.current++;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (file) return;
    const request = ++cameraRequest.current;
    let cancelled = false;
    let ownedStream: MediaStream | null = null;
    // The promise callback also runs after the video element has mounted.
    void Promise.resolve().then(async () => {
      if (cancelled || request !== cameraRequest.current) return;
      setCameraOpen(true); setCameraStarting(true);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled || request !== cameraRequest.current) { stream.getTracks().forEach((track) => track.stop()); return; }
        ownedStream = stream;
        cameraStream.current = stream;
        if (!video.current) throw new Error("Camera preview unavailable");
        video.current.srcObject = stream;
        await video.current.play();
      } catch {
        if (cancelled || request !== cameraRequest.current) return;
        cameraStream.current?.getTracks().forEach((track) => track.stop());
        cameraStream.current = null;
        // No camera, or permission not given yet: quietly fall back to the
        // Use camera / Upload buttons instead of greeting the user with an error.
        setCameraOpen(false);
      } finally {
        if (!cancelled && request === cameraRequest.current) setCameraStarting(false);
      }
    });
    return () => {
      cancelled = true;
      ownedStream?.getTracks().forEach((track) => track.stop());
    };
  }, [file]);

  function closeCamera() {
    cameraRequest.current++;
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraOpen(false); setCameraStarting(false);
  }

  async function openCamera() {
    if (busy || frozen || cameraStarting || cameraOpen) return;
    const request = ++cameraRequest.current;
    setError(""); setCameraOpen(true); setCameraStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (request !== cameraRequest.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      cameraStream.current = stream;
      if (!video.current) throw new Error("Camera preview unavailable");
      video.current.srcObject = stream;
      await video.current.play();
    } catch {
      if (request !== cameraRequest.current) return;
      cameraStream.current?.getTracks().forEach((track) => track.stop());
      cameraStream.current = null;
      setCameraOpen(false);
      setError("Could not open the camera. Allow camera access in your browser, or use Upload file.");
    } finally { if (request === cameraRequest.current) setCameraStarting(false); }
  }

  async function capturePhoto() {
    if (busy || cameraStarting || lock.current) return;
    const element = video.current;
    if (!element?.videoWidth || !element.videoHeight) { setError("The camera is not ready yet. Please try again."); return; }
    const request = cameraRequest.current;
    setCameraStarting(true);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(element.videoWidth, element.videoHeight));
      canvas.width = Math.round(element.videoWidth * scale); canvas.height = Math.round(element.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not capture photo");
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (request !== cameraRequest.current) return;
      if (!blob) throw new Error("Could not capture photo");
      closeCamera();
      await startScan(new File([blob], "receipt-camera.jpg", { type: "image/jpeg" }), true);
    } catch {
      setError("Could not take the photo. Please try again or upload a file.");
    } finally { if (request === cameraRequest.current) setCameraStarting(false); }
  }

  async function currentUser() {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      router.replace("/login");
      throw new Error("Please log in before scanning or saving receipts.");
    }
    return { supabase, user };
  }

  async function removeUnsavedSource() {
    const uploaded = source.current;
    if (!uploaded) return;
    const { supabase, user } = await currentUser();
    if (user.id !== uploaded.userId) throw new Error("Use the original account to remove this file.");
    const { data: linked, error: lookupError } = await supabase.from("receipts").select("id").eq("image_path", uploaded.path).limit(1);
    if (lookupError) throw new Error("Could not check whether this file was saved. Please check the save status again.");
    if (linked?.length) throw new Error("This file is linked to saved receipts. Check the save status before leaving.");
    const { error: removeError } = await supabase.storage.from("receipts").remove([uploaded.path]);
    if (removeError) throw new Error(`Could not remove the unsaved file: ${removeError.message}`);
    source.current = null;
  }

  async function scan(selected: File) {
    setPhase("preparing");
    const prepared = await prepareReceiptFile(selected);
    const { supabase, user } = await currentUser();
    if (source.current && source.current.userId !== user.id) throw new Error("Your account changed. Use the original account to cancel this scan.");
    if (!source.current) {
      const path = `${user.id}/${crypto.randomUUID()}.${prepared.extension}`;
      setPhase("uploading");
      // Track the intended path even when the upload response is lost.
      source.current = { userId: user.id, path };
      const { error: uploadError } = await supabase.storage.from("receipts").upload(path, prepared.blob, { contentType: prepared.blob.type });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}${selected.type === "application/pdf" ? " Check that the receipts bucket allows PDF files." : ""}`);
    }
    setPhase("scanning");
    const response = await fetch("/api/scan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: source.current.path }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) router.replace("/login");
      throw new Error(typeof payload?.error === "string" ? payload.error : "Could not scan this file. Please retry.");
    }
    const result = normalizeDocument(payload);
    const { data: available, error: categoryError } = await supabase.from("categories").select("id, name, user_id").order("name");
    const items: Category[] = available ?? [];
    setCategories(items);
    const newDrafts = result.receipts.map((receipt) => toDraft(receipt, items));
    setDrafts(newDrafts);
    setOtherNames({});
    setDupes(await findDuplicates(supabase, newDrafts));
    setScanComplete(true);
    setNotice(categoryError ? "Categories could not be loaded. You can save without one." : "");
    setPhase("reviewing");
  }

  async function startScan(selected: File, replace: boolean) {
    if (lock.current || pending.current) return;
    lock.current = true; setError(""); setNotice("");
    try {
      if (replace) {
        setPhase("cancelling");
        await removeUnsavedSource();
        setFile(selected); setPreview(URL.createObjectURL(selected));
        setDrafts([]); setScanComplete(false); setFrozen(false);
      }
      await scan(selected);
    } catch (err) {
      let message = err instanceof Error ? err.message : "Could not scan this file.";
      try { await removeUnsavedSource(); }
      catch (cleanupError) { message += ` ${cleanupError instanceof Error ? cleanupError.message : "Cleanup failed. Retry Cancel."}`; }
      setScanComplete(false); setDrafts([]); setError(message); setPhase("idle");
    } finally { lock.current = false; }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (selected) { closeCamera(); void startScan(selected, true); }
  }

  async function cancel() {
    if (lock.current) return;
    lock.current = true; setPhase("cancelling"); setError("");
    try {
      await removeUnsavedSource();
      pending.current = null;
      setFrozen(false); setFile(null); setPreview(null); setDrafts([]); setScanComplete(false); setNotice("");
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel. Try again.");
      setPhase(scanComplete ? "reviewing" : "idle");
    } finally { lock.current = false; }
  }

  function update(id: string, changes: Partial<ReceiptDraft>) {
    setDrafts((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
    setError("");
  }

  async function saveAll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setPhase("saving"); setError("");
    try {
      const { supabase, user } = await currentUser();
      if (!source.current || source.current.userId !== user.id) throw new Error("Use the account that scanned this file.");
      if (pending.current && pending.current.userId !== user.id) throw new Error("Sign in to the original account to check this batch.");
      if (!pending.current) {
        // "Other" + a typed name becomes the user's own category (reused if it exists).
        let known = categories;
        const resolved: ReceiptDraft[] = [];
        for (const d of drafts) {
          const typed = otherNames[d.id]?.trim();
          if (typed && isDefaultOther(known.find((c) => c.id === d.categoryId))) {
            const { id, created } = await categoryForOther(supabase, user.id, typed, known);
            if (created) known = [...known, created];
            resolved.push({ ...d, categoryId: id });
          } else resolved.push(d);
        }
        if (known !== categories) setCategories(known);
        const rows = buildReceiptBatch(resolved, user.id, source.current.path);
        if (rows.some((row) => row.category_id && !known.some((category) => category.id === row.category_id))) throw new Error("Please select a valid category.");
        pending.current = { userId: user.id, rows }; setFrozen(true);
      }
      await saveReceiptBatch(pending.current.rows, {
        find: async (ids) => {
          const found: string[] = [];
          for (let offset = 0; offset < ids.length; offset += 100) {
            const { data, error: queryError } = await supabase.from("receipts").select("id").eq("user_id", user.id).in("id", ids.slice(offset, offset + 100));
            if (queryError) throw new Error("Could not confirm save status. Retry to check the same batch.");
            found.push(...(data ?? []).map((row) => row.id));
          }
          return found;
        },
        insert: async (rows) => {
          const { error: insertError } = await supabase.from("receipts").insert(rows);
          if (insertError) throw new Error(`Save failed: ${insertError.message}`);
        },
      });
      source.current = null;
      const saved = pending.current?.rows ?? [];
      const count = saved.length;
      setFlash({ text: count === 1 ? "Receipt saved" : `${count} receipts saved`, ids: saved.map((r) => r.id), scanNext: true });
      // Leave this page clean, so coming back starts a fresh scan.
      pending.current = null;
      setFrozen(false); setFile(null); setPreview(null); setDrafts([]); setScanComplete(false);
      setOtherNames({}); setDupes({}); setPhase("idle");
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save was not confirmed. Retry to check the same batch.");
      setPhase("reviewing");
    } finally { lock.current = false; }
  }

  const isPdf = file?.type === "application/pdf";

  return (
    <main className="flex min-h-screen flex-col pb-36" aria-busy={busy}>
      <header className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center px-4 pb-2 pt-[max(20px,env(safe-area-inset-top))]">
        <Link href="/" aria-label="Back to expenses" className="tap flex h-11 w-11 items-center justify-center rounded-full bg-surface">
          <Icon d={ICONS.back} stroke={2.2} />
        </Link>
        <h1 className="text-center text-[17px] font-semibold">{scanComplete ? "Check details" : "Scan receipt"}</h1>
        <span />
      </header>

      <div className="flex flex-col gap-3.5 px-5 pt-2">
        <input ref={picker} aria-label="Choose receipt image or PDF" type="file" accept="image/*,application/pdf" onChange={selectFile} hidden disabled={busy || frozen} />

        {/* Live camera */}
        <section hidden={!cameraOpen} aria-label="Camera" className="anim-fade overflow-hidden rounded-[28px] bg-[#050505] text-white">
          <div className="relative">
            <video ref={video} autoPlay muted playsInline className="aspect-[3/4] w-full bg-black object-cover" />
            <span aria-hidden="true" className="absolute left-6 top-6 h-9 w-9 rounded-tl-[14px] border-l-[3px] border-t-[3px] border-white" />
            <span aria-hidden="true" className="absolute right-6 top-6 h-9 w-9 rounded-tr-[14px] border-r-[3px] border-t-[3px] border-white" />
            <span aria-hidden="true" className="absolute bottom-6 left-6 h-9 w-9 rounded-bl-[14px] border-b-[3px] border-l-[3px] border-white" />
            <span aria-hidden="true" className="absolute bottom-6 right-6 h-9 w-9 rounded-br-[14px] border-b-[3px] border-r-[3px] border-white" />
            <p className="absolute inset-x-0 bottom-16 mx-auto w-fit rounded-full bg-white/15 px-3.5 py-2 text-[13px] backdrop-blur-sm">
              {cameraStarting ? "Starting camera…" : "Fit the whole receipt inside the frame"}
            </p>
          </div>
          <div className="grid grid-cols-3 items-center px-6 pb-6 pt-5">
            <div className="flex flex-col items-center gap-1.5">
              <button type="button" aria-label="Upload a photo or PDF instead" disabled={busy || frozen} onClick={() => picker.current?.click()}
                className="tap flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15">
                <Icon d={ICONS.upload} size={22} />
              </button>
              <span className="text-xs text-white/75">Upload</span>
            </div>
            <div className="flex justify-center">
              <button type="button" aria-label="Take photo and scan" disabled={cameraStarting || busy} onClick={() => void capturePhoto()}
                className="tap flex h-20 w-20 items-center justify-center rounded-full border-4 border-white p-[5px] disabled:opacity-50">
                <span className="block h-full w-full rounded-full bg-white" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <button type="button" aria-label="Close camera" onClick={closeCamera}
                className="tap flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/15">
                <Icon d={ICONS.close} size={20} stroke={2} />
              </button>
              <span className="text-xs text-white/75">Close</span>
            </div>
          </div>
        </section>

        {/* Start: choose camera or file */}
        {!cameraOpen && !file && (
          <section className="anim-fade flex flex-col gap-3 pt-6">
            <p className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">Snap or upload a receipt</p>
            <p className="text-[15px] text-muted">We&apos;ll read the shop, date and total. One photo or PDF can hold several receipts.</p>
            <button type="button" disabled={busy || frozen || cameraStarting} onClick={() => void openCamera()}
              className="tap mt-4 flex h-14 items-center justify-center gap-2.5 rounded-[18px] bg-fg text-[17px] font-semibold text-bg disabled:opacity-60">
              <Icon d={ICONS.camera} size={22} stroke={1.9} /> Use camera
            </button>
            <button type="button" disabled={busy || frozen} onClick={() => picker.current?.click()}
              className="tap flex h-14 items-center justify-center gap-2.5 rounded-[18px] bg-surface text-[17px] font-medium">
              <Icon d={ICONS.upload} size={22} /> Upload photo or PDF
            </button>
            <p className="text-center text-[13px] text-muted">JPG, PNG or PDF up to 5 MB. Scanning starts by itself.</p>
          </section>
        )}

        {/* Chosen file */}
        {file && (
          <section className="anim-rise flex items-center gap-3.5 rounded-[20px] bg-surface p-3">
            {preview && !isPdf ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-[62px] w-[46px] shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex h-[62px] w-[46px] shrink-0 items-center justify-center rounded-md bg-surface2 text-muted"><Icon d={ICONS.file} size={22} /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{scanComplete ? `${drafts.length} receipt${drafts.length === 1 ? "" : "s"} found` : file.name}</p>
              {isPdf && preview ? (
                <a href={preview} target="_blank" rel="noreferrer" className="text-[13px] text-muted underline">Open original PDF</a>
              ) : (
                <p className="text-[13px] text-muted">{scanComplete ? "Check each one before saving" : "Your photo"}</p>
              )}
            </div>
            <button type="button" disabled={busy || frozen} onClick={() => void cancel()} className="tap h-10 rounded-full bg-surface2 px-3.5 text-sm font-medium">
              {scanComplete ? "Retake" : "Remove"}
            </button>
          </section>
        )}
        {file && !scanComplete && !busy && (
          <button type="button" className={secondary} disabled={frozen} onClick={() => void startScan(file, false)}>Try scanning again</button>
        )}

        {busy && (
          <div role="status" className="anim-rise flex items-center gap-3.5 rounded-[20px] bg-surface p-4">
            <span className="text-brand"><Spinner size={24} /></span>
            <div>
              <p className="text-base font-medium">{labels[phase]}</p>
              {phase === "scanning" && <p className="text-[13px] text-muted">This takes a few seconds. Keep this screen open.</p>}
            </div>
          </div>
        )}
        {error && <p role="alert" className="anim-rise rounded-2xl bg-surface p-4 text-[15px] leading-snug text-danger">{error}</p>}
        {notice && <p role="status" className="mx-1 text-sm text-muted">{notice}</p>}

        {scanComplete && (
          <form onSubmit={saveAll} className="flex flex-col gap-5 pt-1">
            {!drafts.length && (
              <p className="rounded-[20px] bg-surface p-4 text-[15px]">No receipts to save. Add one by hand if we missed it, or choose another file.</p>
            )}
            {drafts.map((draft, index) => {
              const warning = scanWarning(draft.confidence);
              return (
                <fieldset key={draft.id} disabled={busy || frozen || cameraOpen} className="anim-rise flex min-w-0 flex-col gap-3 disabled:opacity-60" style={{ animationDelay: `${index * 60}ms` }}>
                  {drafts.length > 1 && <legend className="mx-1 mb-2.5 text-[13px] font-semibold uppercase tracking-wider text-muted">Receipt {index + 1}</legend>}
                  {[warning, dupes[draft.id], draft.date && draft.date > todayIso() ? "This date is in the future. Check the year on the receipt." : null]
                    .filter(Boolean)
                    .map((msg) => (
                      <p key={msg} className="flex items-start gap-2.5 rounded-2xl bg-warn-bg px-3.5 py-3 text-sm leading-snug text-warn-fg">
                        <Icon d={ICONS.warn} size={18} stroke={2} className="mt-px shrink-0" />{msg}
                      </p>
                    ))}
                  {isPdf && preview && <PdfReceiptPreview url={preview} sourcePages={draft.sourcePages} index={index} />}

                  <label className="field-card block rounded-[20px] bg-surface p-4 transition-shadow">
                    <span className="block text-[13px] text-muted">Total paid</span>
                    <span className="mt-1 flex items-baseline gap-1">
                      <span className="text-[30px] font-medium">฿</span>
                      <input type="number" required min="0.01" max="99999999.99" step="0.01" inputMode="decimal" aria-label="Total in baht"
                        value={draft.total} onChange={(event) => update(draft.id, { total: event.target.value })}
                        className="min-w-0 flex-1 bg-transparent text-[40px] font-semibold tracking-[-0.03em] tabular-nums outline-none" />
                    </span>
                  </label>

                  <div className="field-card rounded-[20px] bg-surface px-4 transition-shadow">
                    <label className="flex min-h-[52px] items-center gap-3 border-b border-line">
                      <span className="w-[72px] shrink-0 text-[15px]">Shop</span>
                      <input className={rowInput} value={draft.shopName} placeholder="Shop name" onChange={(event) => update(draft.id, { shopName: event.target.value })} />
                    </label>
                    <label className="flex min-h-[52px] items-center gap-3 border-b border-line">
                      <span className="w-[72px] shrink-0 text-[15px]">Date</span>
                      <input className={rowInput} type="date" value={draft.date} onChange={(event) => update(draft.id, { date: event.target.value })} />
                    </label>
                    <label className="flex min-h-[52px] items-center gap-3 border-b border-line">
                      <span className="w-[72px] shrink-0 text-[15px]">Category</span>
                      <select className={`${rowInput} appearance-none`} value={draft.categoryId} onChange={(event) => update(draft.id, { categoryId: event.target.value })}>
                        <option value="">No category</option>
                        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.user_id ? " (personal)" : ""}</option>)}
                      </select>
                      <Icon d={ICONS.chevron} size={16} stroke={2} className="shrink-0 rotate-90 text-muted" />
                    </label>
                    {isDefaultOther(categories.find((c) => c.id === draft.categoryId)) && (
                      <label className="anim-rise flex min-h-[52px] items-center gap-3 border-b border-line">
                        <span className="w-[72px] shrink-0 text-[15px]">Name it</span>
                        <input className={rowInput} value={otherNames[draft.id] ?? ""} maxLength={40} autoFocus
                          placeholder="Club T-shirts"
                          onChange={(event) => setOtherNames((m) => ({ ...m, [draft.id]: event.target.value }))} />
                      </label>
                    )}
                    <label className="flex min-h-[52px] items-center gap-3">
                      <span className="w-[72px] shrink-0 text-[15px]">Note</span>
                      <input className={rowInput} value={draft.note} placeholder="Add a note" onChange={(event) => update(draft.id, { note: event.target.value })} />
                    </label>
                  </div>

                  {draft.currency && draft.currency !== "THB" ? (
                    <p role="alert" className="rounded-2xl bg-surface p-4 text-sm text-danger">This receipt isn&apos;t in Thai baht ({draft.currency}). Remove it to save the others.</p>
                  ) : !draft.currency && (
                    <label className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-sm">
                      <input type="checkbox" required checked={draft.confirmedThb} onChange={(event) => update(draft.id, { confirmedThb: event.target.checked })} className="h-5 w-5 shrink-0 accent-[#22D27F]" />
                      We couldn&apos;t see the currency. I checked: this amount is in baht.
                    </label>
                  )}

                  {drafts.length > 1 && (
                    <button type="button" className="tap h-11 self-center rounded-full px-4 text-[15px] font-medium text-danger" onClick={() => setDrafts((items) => items.filter((item) => item.id !== draft.id))}>
                      Remove this receipt
                    </button>
                  )}
                </fieldset>
              );
            })}
            <button type="button" className={secondary} disabled={busy || frozen} onClick={() => setDrafts((items) => [...items, toDraft()])}>
              + Add a receipt we missed
            </button>
            {frozen && <p className="mx-1 text-[13px] text-muted">We&apos;re keeping this batch as it is while we check whether it saved.</p>}

            <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md bg-bg px-5 pb-[max(30px,env(safe-area-inset-bottom))] pt-3">
              <button type="submit" disabled={busy || cameraOpen || !drafts.length}
                className="tap flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-brand text-[17px] font-semibold text-ink disabled:opacity-50">
                {phase === "saving" && <Spinner />}
                {frozen ? "Check status and retry" : drafts.length === 1 ? "Save receipt" : `Save ${drafts.length} receipts`}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
