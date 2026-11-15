"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { normalizeDocument, scanWarning, type ScannedReceipt } from "@/lib/receipt-validation";
import { buildReceiptBatch, saveReceiptBatch, type ReceiptBatch, type ReceiptDraft } from "@/lib/receipt-batch";
import { prepareReceiptFile } from "@/lib/receipt-file";

type Phase = "idle" | "preparing" | "uploading" | "scanning" | "reviewing" | "saving" | "cancelling";
type Category = { id: string; name: string; user_id: string | null };
type Source = { userId: string; path: string };
const labels: Partial<Record<Phase, string>> = {
  preparing: "Preparing your file…", uploading: "Uploading your file…", scanning: "Reading receipts…",
  saving: "Saving all receipts…", cancelling: "Removing unsaved file…",
};
const control = "mt-1 block w-full rounded border border-gray-400 bg-transparent p-2";
const button = "rounded border border-gray-400 px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50";

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
    <div className="space-y-2 rounded border border-gray-400 p-3">
      <p className="font-medium">Original PDF — receipt {index + 1}</p>
      <p className="text-sm">{sourcePages.length ? `AI suggested page(s): ${sourcePages.join(", ")}. Verify the page against the original.` : "AI did not identify a page. Enter a page number or browse the document."}</p>
      <label className="block text-sm">Page to display
        <input type="number" min="1" step="1" inputMode="numeric" value={page} onChange={(event) => setPage(event.target.value)} placeholder="Full document" className={control} />
      </label>
      <iframe key={pageUrl} src={pageUrl} title={`PDF preview for receipt ${index + 1}`} className="h-80 w-full rounded border border-gray-400 bg-white lg:h-[36rem]" />
      <a href={pageUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline">Open PDF{validPage ? ` at page ${pageNumber}` : ""} in a new tab</a>
      <p className="text-xs">Some browsers may ignore the page number or not show an embedded PDF. Use the link above if needed.</p>
    </div>
  );
}

export default function ScanPage() {
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
        setCameraOpen(false);
        setError("Camera access is unavailable. Allow camera access in your browser, or use Upload file.");
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
    setDrafts(result.receipts.map((receipt) => toDraft(receipt, items)));
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
        const rows = buildReceiptBatch(drafts, user.id, source.current.path);
        if (rows.some((row) => row.category_id && !categories.some((category) => category.id === row.category_id))) throw new Error("Please select a valid category.");
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
      setNotice("All receipts saved. Opening home…");
      router.replace("/"); router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save was not confirmed. Retry to check the same batch.");
      setPhase("reviewing");
    } finally { lock.current = false; }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6" aria-busy={busy}>
      <header className={!file ? "pt-8 text-center" : ""}><Link href="/" className="mb-3 inline-block text-sm underline">Back to expenses</Link><h1 className="text-3xl font-semibold">Scan receipts</h1><p className="mt-2">Take a photo of your receipt. We will read it for you.</p></header>
      <section className={`space-y-4 rounded border border-gray-400 p-5 ${!file ? "py-10 text-center" : ""}`} aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="sr-only">Choose how to scan your receipts</h2>
        <input ref={picker} aria-label="Choose receipt image or PDF" type="file" accept="image/*,application/pdf" onChange={selectFile} hidden disabled={busy || frozen} />
        <div hidden={!cameraOpen} className="space-y-3" aria-label="Camera preview">
          <video ref={video} autoPlay muted playsInline className="mx-auto max-h-96 w-full rounded bg-black object-contain" />
          {cameraStarting && <p role="status">Preparing camera…</p>}
          <div className="flex flex-wrap justify-center gap-3"><button type="button" className={`${button} min-h-14 px-8 font-semibold`} disabled={cameraStarting || busy} onClick={() => void capturePhoto()}>Take photo and scan</button><button type="button" className={button} onClick={closeCamera}>Close camera</button></div>
        </div>
        <div className="mx-auto flex max-w-sm flex-col gap-3">
          {!cameraOpen && <button type="button" className={`${button} min-h-14 font-semibold`} disabled={busy || frozen || cameraStarting} onClick={() => void openCamera()}>Use camera</button>}
          <button type="button" className={button} disabled={busy || frozen} onClick={() => picker.current?.click()}>Upload file</button>
          <p className="text-center text-sm">Choose an image or PDF up to 5 MB. Scanning starts automatically.</p>
        </div>
        {file && <div className="space-y-3"><p className="break-all font-medium">{file.name}</p>
          {preview && (file.type === "application/pdf" ? <a href={preview} target="_blank" rel="noreferrer" className="underline">Open original PDF</a> :
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Selected receipt" className="max-h-80 max-w-full object-contain" />)}
          <div><button type="button" className={button} disabled={busy || frozen} onClick={() => void cancel()}>Cancel / remove file</button></div>
          {!scanComplete && !busy && <button type="button" className={button} disabled={frozen} onClick={() => void startScan(file, false)}>Retry scan</button>}
        </div>}
      </section>
      {busy && <div role="status" className="flex items-center gap-3"><span aria-hidden="true" className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent motion-reduce:animate-none" /><span>{labels[phase]}</span></div>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {scanComplete && <form onSubmit={saveAll} className="space-y-5">
        <h2 className="text-lg font-medium">2. Review {drafts.length} receipt{drafts.length === 1 ? "" : "s"}</h2>
        {!drafts.length && <p>No receipts to save. Add a receipt manually if AI missed it, or choose another file.</p>}
        {drafts.map((draft, index) => <fieldset key={draft.id} disabled={busy || frozen || cameraOpen} className="space-y-3 rounded border border-gray-400 p-4 disabled:opacity-60">
          <legend className="px-1 font-medium">Receipt {index + 1}</legend>
          {scanWarning(draft.confidence) && <p className="rounded border border-amber-400 p-2 text-sm text-amber-700 dark:text-amber-300">{scanWarning(draft.confidence)}</p>}
          <div className={file?.type === "application/pdf" && preview ? "grid gap-5 lg:grid-cols-2" : ""}>
          {file?.type === "application/pdf" && preview && <PdfReceiptPreview url={preview} sourcePages={draft.sourcePages} index={index} />}
          <div className="space-y-3">
          {draft.sourcePages.length > 0 && <p className="text-sm">Source page(s): {draft.sourcePages.join(", ")} — check against the original</p>}
          <label className="block">Shop name<input className={control} value={draft.shopName} onChange={(event) => update(draft.id, { shopName: event.target.value })} /></label>
          <label className="block">Receipt date<input className={control} type="date" value={draft.date} onChange={(event) => update(draft.id, { date: event.target.value })} /></label>
          <label className="block">Total (THB)<input className={control} type="number" required min="0.01" max="99999999.99" step="0.01" value={draft.total} onChange={(event) => update(draft.id, { total: event.target.value })} /></label>
          <p>Currency: {draft.currency ?? "Not identified"}</p>
          {draft.currency && draft.currency !== "THB" ? <p role="alert">This receipt is not in THB. Remove it before saving this batch.</p> : !draft.currency && <label className="block"><input type="checkbox" required checked={draft.confirmedThb} onChange={(event) => update(draft.id, { confirmedThb: event.target.checked })} /> I checked the original and confirm this amount is in THB.</label>}
          <label className="block">Category<select className={control} value={draft.categoryId} onChange={(event) => update(draft.id, { categoryId: event.target.value })}><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.user_id ? " (personal)" : ""}</option>)}</select></label>
          <label className="block">Note<textarea className={control} value={draft.note} onChange={(event) => update(draft.id, { note: event.target.value })} /></label>
          <button type="button" className={button} onClick={() => setDrafts((items) => items.filter((item) => item.id !== draft.id))}>Remove this receipt</button>
          </div>
          </div>
        </fieldset>)}
        <button type="button" className={button} disabled={busy || frozen} onClick={() => setDrafts((items) => [...items, toDraft()])}>Add a missing receipt</button>
        {frozen && <p>The submitted batch is kept unchanged while its save status is checked.</p>}
        <div><button type="submit" className={button} disabled={busy || cameraOpen || !drafts.length}>{frozen ? "Check status / retry Save all" : `Save all ${drafts.length} receipt${drafts.length === 1 ? "" : "s"}`}</button></div>
      </form>}
    </main>
  );
}
