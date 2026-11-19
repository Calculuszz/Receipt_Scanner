export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
/** For <input accept>: Windows often gives .heic files no MIME type, so list the extensions too. */
export const RECEIPT_ACCEPT = "image/*,.heic,.heif,application/pdf";

/** HEIF files start with an ISO box: bytes 4–8 are "ftyp", then a brand such as "heic". */
const HEIF_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;

export async function looksLikeHeic(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return false;
  const text = new TextDecoder("latin1").decode(head);
  return text.slice(4, 8) === "ftyp" && HEIF_BRANDS.test(text.slice(8, 12));
}

/**
 * Open an image as a bitmap. The browser's own decoder is tried first (Safari reads HEIC);
 * Chrome, Edge and Firefox cannot, so for HEIC we load a WebAssembly decoder only then.
 */
async function decodeImage(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (nativeError) {
    if (!(await looksLikeHeic(file))) throw nativeError;
    const { heicTo } = await import("heic-to");
    return await heicTo({ blob: file, type: "bitmap" });
  }
}

export async function prepareReceiptFile(file: File, onStatus?: (text: string) => void): Promise<{ blob: Blob; extension: string }> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_RECEIPT_BYTES) throw new Error("Choose a PDF no larger than 5 MB.");
    const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (header !== "%PDF-") throw new Error("This file does not appear to be a PDF.");
    return { blob: file, extension: "pdf" };
  }
  const heic = await looksLikeHeic(file);
  if (!file.type.startsWith("image/") && !heic) throw new Error("Choose an image or PDF.");
  if (heic) onStatus?.("Converting iPhone photo…");
  let bitmap: ImageBitmap;
  try { bitmap = await decodeImage(file); }
  catch {
    throw new Error(heic
      ? "Could not convert this iPhone photo. Try the camera button, or export it as JPG."
      : "Cannot open this image. Try JPEG or PNG.");
  }
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
    if (!blob || blob.type !== "image/jpeg" || blob.size > MAX_RECEIPT_BYTES) throw new Error("Could not compress this image below 5 MB.");
    return { blob, extension: "jpg" };
  } finally { bitmap.close(); }
}
