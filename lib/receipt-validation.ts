export const RECEIPT_CATEGORIES = ["Food & Drinks", "Transport", "Equipment", "Printing & Stationery", "Venue", "Other"];

export function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export class UnsupportedCurrencyError extends Error {}

export function scanWarning(confidence: number | null): string | null {
  if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (confidence < 0.5) return "Hard to read. Check every field against the photo.";
  if (confidence < 0.8) return "Partly unclear. Check the details against the photo.";
  return null;
}

export function normalizeReceipt(result: unknown, allowUnsupportedCurrency = false) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("Invalid Gemini response");
  const fields = result as Record<string, unknown>;
  const rawCurrency = typeof fields.currency === "string" ? fields.currency.trim().toUpperCase() : "";
  const unknown = !rawCurrency || ["UNKNOWN", "N/A", "NULL"].includes(rawCurrency);
  const thb = ["THB", "฿", "BAHT", "THAI BAHT", "บาท"].includes(rawCurrency);
  if (!unknown && !thb && !allowUnsupportedCurrency) throw new UnsupportedCurrencyError("Only THB receipts are supported. Currency conversion is not available.");
  const total = fields.total;
  const confidence = fields.confidence;
  return {
    shop_name: typeof fields.shop_name === "string" && fields.shop_name.trim() ? fields.shop_name.trim() : null,
    receipt_date: validDate(fields.receipt_date),
    total: typeof total === "number" && Number.isFinite(total) && total > 0 && total <= 99999999.99 && Math.abs(total * 100 - Math.round(total * 100)) < 1e-6 ? total : null,
    currency: thb ? "THB" : unknown ? null : rawCurrency,
    category: RECEIPT_CATEGORIES.find((category) => typeof fields.category === "string" && category.toLowerCase() === fields.category.trim().toLowerCase()) ?? null,
    confidence: typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
    source_pages: Array.isArray(fields.source_pages) ? [...new Set(fields.source_pages.filter((page): page is number => typeof page === "number" && Number.isSafeInteger(page) && page > 0))] : [],
  };
}

export type ScannedReceipt = ReturnType<typeof normalizeReceipt>;

export function normalizeDocument(result: unknown): { receipts: ScannedReceipt[] } {
  if (!result || typeof result !== "object" || !("receipts" in result) || !Array.isArray(result.receipts)) throw new Error("Invalid receipt list returned by AI.");
  return { receipts: result.receipts.map((receipt) => normalizeReceipt(receipt, true)) };
}
