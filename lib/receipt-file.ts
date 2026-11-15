export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];

export async function prepareReceiptFile(file: File): Promise<{ blob: Blob; extension: string }> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_RECEIPT_BYTES) throw new Error("Choose a PDF no larger than 5 MB.");
    const header = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (header !== "%PDF-") throw new Error("This file does not appear to be a PDF.");
    return { blob: file, extension: "pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Choose an image or PDF.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("Cannot open this image. Try JPEG or PNG."); }
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
