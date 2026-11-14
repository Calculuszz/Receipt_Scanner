"use client";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

async function resizePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("Cannot open this image. Try a JPEG or PNG photo."); }
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.type !== "image/jpeg" || blob.size > 5 * 1024 * 1024) throw new Error("Could not compress the photo below 5 MB.");
    return blob;
  } finally { bitmap.close(); }
}

async function checkSession() {
  const supabase = createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    console.log("ยังไม่ได้เข้าสู่ระบบ");
    return;
  }

  console.log("เข้าสู่ระบบแล้ว User ID:", user.id);
}

export default function ScanPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState<{
    shop_name: string | null;
    receipt_date: string | null;
    total: number | null;
    category: string | null;
    confidence: number | null;
    currency: string | null;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [categories, setCategories] = useState<{ id: string; name: string; user_id: string | null }[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const saveLock = useRef(false);
  const uploadRef = useRef<{ userId: string; path: string } | null>(null);
  const receiptIdRef = useRef<string | null>(null);

  async function discardUnsavedPhoto() {
    const upload = uploadRef.current;
    if (!upload || saved) return;
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user || user.id !== upload.userId) throw new Error("Log back into the original account to remove the uploaded photo.");
    const { data: linked, error: checkError } = await supabase.from("receipts").select("id").eq("image_path", upload.path).limit(1);
    if (checkError) throw new Error("Could not verify whether the photo is saved. Try again later.");
    if (linked?.length) throw new Error("This photo is linked to a saved receipt and was not removed.");
    const { error: removeError } = await supabase.storage.from("receipts").remove([upload.path]);
    if (removeError) throw new Error(`Could not remove uploaded photo: ${removeError.message}`);
    uploadRef.current = null;
  }

  async function handleTestLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage("Login failed. Check your account and email confirmation.");
        return;
      }
      form.reset();
      setAuthMessage("Login successful. You can now check your session.");
    } catch {
      setAuthMessage("Could not connect to Supabase. Check your configuration and connection.");
    } finally {
      setAuthLoading(false);
    }
  }

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  async function handleScan() {
  if (!file) return;

  setMessage("");
  setError("");
  setScanned(false);
  setLoading(true);

  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Please log in before scanning.");
    if (uploadRef.current && uploadRef.current.userId !== user.id) throw new Error("Your account changed. Select the photo again.");
    if (!uploadRef.current) {
      const compressed = await resizePhoto(file);
      const path = `${user.id}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("receipts").upload(path, compressed, { contentType: "image/jpeg" });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      uploadRef.current = { userId: user.id, path };
    }

    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: uploadRef.current.path }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(typeof failure?.error === "string" ? failure.error : "Scan request failed. Please try again.");
    }

    const result = await response.json();

    setScanResult(result);
    try {
      const supabase = createClient();
      const { data: available, error: categoryError } = await supabase.from("categories").select("id, name, user_id").order("name");
      if (categoryError) throw categoryError;
      const items = available ?? [];
      setCategories(items);
      const suggested = typeof result.category === "string" ? result.category.trim().toLowerCase() : "";
      const match = items.find((item) => item.name.toLowerCase() === suggested && item.user_id === null) ?? items.find((item) => item.name.toLowerCase() === suggested);
      setCategoryId(match?.id ?? "");
      if (!match && suggested) setMessage("The suggested category was not found. Select a category or leave it blank.");
    } catch {
      setCategories([]);
      setCategoryId("");
      setMessage("Could not load categories. You can save without one.");
    }
    setScanned(true);
  } catch (err) {
    const originalMessage = err instanceof Error ? err.message : "Could not scan the receipt. Please try again.";
    try { await discardUnsavedPhoto(); setError(originalMessage); }
    catch (cleanupError) { setError(`${originalMessage} ${cleanupError instanceof Error ? cleanupError.message : "Could not remove the uploaded photo."}`); }
  } finally {
    setLoading(false);
  }
  }


  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setLoading(true);
    try { await discardUnsavedPhoto(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove the previous photo."); if (inputRef.current) inputRef.current.value = ""; setLoading(false); return; }
    setLoading(false);
    setScanned(false);
    setScanResult(null);
    setCategories([]);
    setCategoryId("");
    setSaved(false);
    uploadRef.current = null;
    receiptIdRef.current = null;
    setMessage("");
    if (!selected.type.startsWith("image/")) {
      setError("Please choose an image file.");
      setFile(null);
      setPreview(null);
      return;
    }
    setError("");
    setPreview(URL.createObjectURL(selected));
    setFile(selected);
  }

  async function clearPhoto() {
    setLoading(true);
    try { await discardUnsavedPhoto(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove the uploaded photo."); setLoading(false); return; }
    setLoading(false);
    setFile(null);
    setPreview(null);
    setError("");
    setScanned(false);
    setScanResult(null);
    setCategories([]);
    setCategoryId("");
    setSaved(false);
    uploadRef.current = null;
    receiptIdRef.current = null;
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveLock.current || saved || !file) return;
    const data = new FormData(event.currentTarget);
    const shopName = String(data.get("shopName") ?? "").trim();
    const total = Number(data.get("total"));
    const date = String(data.get("receiptDate") ?? "");
    const selectedCategoryId = String(data.get("category") ?? "");
    const note = String(data.get("note") ?? "").trim();
    if (scanResult?.currency !== "THB" && data.get("confirmThb") !== "on") {
      setMessage("Please confirm from the original receipt that the amount is in THB.");
      return;
    }
    if (!Number.isFinite(total) || total <= 0 || total > 99999999.99) {
      setMessage("Enter a total greater than zero and no more than 99,999,999.99 THB.");
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Please log in before saving.");
      if (selectedCategoryId && !categories.some((category) => category.id === selectedCategoryId)) throw new Error("Please select a valid category.");
      if (uploadRef.current && uploadRef.current.userId !== user.id) throw new Error("Your account changed. Select the photo again before saving.");
      if (!uploadRef.current) throw new Error("Please scan the photo again before saving.");
      const receiptId = receiptIdRef.current ?? crypto.randomUUID();
      receiptIdRef.current = receiptId;
      const { error: insertError } = await supabase.from("receipts").insert({
        id: receiptId, user_id: user.id, shop_name: shopName || null, receipt_date: date || null,
        total, currency: "THB", category_id: selectedCategoryId || null, image_path: uploadRef.current.path,
        note: note || null,
        ai_confidence: typeof scanResult?.confidence === "number" && Number.isFinite(scanResult.confidence) && scanResult.confidence >= 0 && scanResult.confidence <= 1 ? scanResult.confidence : null,
      });
      if (insertError) {
        const { data: existing, error: checkError } = await supabase.from("receipts").select("id").eq("id", receiptId).maybeSingle();
        if (checkError) throw new Error("Could not confirm whether the receipt was saved. Check the receipts table before retrying.");
        if (!existing) throw new Error(`Save failed: ${insertError.message}`);
      }
      setSaved(true);
      setMessage("Receipt saved successfully to Supabase.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save. Check the receipts table before retrying.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 p-6">
      <header>
        <Link href="/" className="mb-3 inline-block text-sm opacity-70 hover:opacity-100">
          ← Back to expenses
        </Link>
        <h1 className="text-2xl font-semibold">Scan receipt</h1>
        <p className="mt-2">Upload a receipt photo, then review its details.</p>
      </header>

      {/* Temporary test login; remove when the team's login page is ready. */}
      <section className="space-y-3 rounded border border-gray-400 p-4" aria-labelledby="test-login-heading">
        <h2 id="test-login-heading" className="text-lg font-medium">Temporary test login</h2>
        <form onSubmit={handleTestLogin} className="space-y-3">
          <label className="block">Email<input name="email" type="email" autoComplete="username" required className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
          <label className="block">Password<input name="password" type="password" autoComplete="current-password" required className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
          <button type="submit" disabled={authLoading || saving || loading} className="rounded border border-gray-400 px-4 py-2 disabled:opacity-50">{authLoading ? "Logging in..." : "Log in"}</button>
        </form>
        {authMessage && <p role="status">{authMessage}</p>}
        <button type="button" onClick={checkSession} className="rounded border border-gray-400 px-4 py-2">Check Supabase session (browser console)</button>
      </section>

      <section className="space-y-4 rounded border border-gray-400 p-4" aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="text-lg font-medium">1. Upload a photo</h2>
        <label htmlFor="receipt-photo" className="block font-medium">Receipt photo</label>
        <input ref={inputRef} id="receipt-photo" type="file" accept="image/*" disabled={loading || saving}
          onChange={handleFileChange} aria-describedby={error ? "photo-error" : undefined}
          className="block w-full" />
        {error && <p id="photo-error" role="alert" className="text-red-600">{error}</p>}
        {file && preview && (
          <div>
            <p className="break-all text-sm">{file.name}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Selected receipt preview" className="mt-3 max-h-96 max-w-full object-contain" />
            <button type="button" disabled={loading || saving} onClick={clearPhoto} className="mt-3 rounded border border-gray-400 px-4 py-2 disabled:opacity-50">{saved ? "Start a new receipt" : "Cancel / remove photo"}</button>
          </div>
        )}
        <div>
          <button type="button" disabled={!file || loading || saving || saved} onClick={handleScan} className="rounded border border-gray-400 px-4 py-2 disabled:opacity-50">{loading ? "Scanning..." : "Scan receipt"}</button>
          <p className="mt-2 text-sm">Review the extracted details before saving.</p>
        </div>
      </section>

      <section className="space-y-4 rounded border border-gray-400 p-4" aria-labelledby="details-heading">
        <h2 id="details-heading" className="text-lg font-medium">2. Review details</h2>
        <p className="text-sm">{scanned ? "Review and edit the extracted details." : "Receipt details will appear here after scanning."}</p>
        {scanned && typeof scanResult?.confidence === "number" && Number.isFinite(scanResult.confidence) && scanResult.confidence >= 0 && scanResult.confidence <= 1 && <p className="text-sm">AI confidence: {Math.round(scanResult.confidence * 100)}% (estimate only; verify the receipt)</p>}
        <form onSubmit={handleReview} onChange={() => setMessage("")}>
          <fieldset key={scanned ? "scanned" : "empty"} disabled={!scanned || saving || saved} className="space-y-3 disabled:opacity-60">
            <p>Currency: {scanResult?.currency === "THB" ? "THB" : "Not identified"}</p>
            {scanResult?.currency !== "THB" && <label className="block"><input name="confirmThb" type="checkbox" required /> I checked the original receipt and confirm the amount is in THB.</label>}
            <label className="block">Shop name<input name="shopName" type="text" defaultValue={scanResult?.shop_name ?? ""} className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
            <label className="block">Receipt date<input name="receiptDate" type="date" defaultValue={scanResult?.receipt_date ?? ""} className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
            <label className="block">Total (THB)<input name="total" required type="number" min="0.01" max="99999999.99" step="0.01" defaultValue={scanResult?.total ?? ""} className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
            <label className="block">Category<select name="category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 block w-full rounded border border-gray-400 bg-transparent p-2"><option value="">No category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.user_id ? " (personal)" : ""}</option>)}</select></label>
            <label className="block">Note<textarea name="note" className="mt-1 block w-full rounded border border-gray-400 p-2" /></label>
            <button type="submit" className="rounded border border-gray-400 px-4 py-2">{saving ? "Saving..." : "Save receipt"}</button>
          </fieldset>
        </form>
        {message && <p role="status" className="text-sm">{message}</p>}
        <p className="text-sm">Scanning uploads the photo; saving adds a receipt to your account.</p>
      </section>
    </main>
  );
}
