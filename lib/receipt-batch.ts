import { validDate } from "./receipt-validation";

export type ReceiptDraft = {
  id: string; shopName: string; date: string; total: string;
  currency: string | null; confirmedThb: boolean; categoryId: string; note: string;
  sourcePages: number[]; confidence: number | null;
};

export function buildReceiptBatch(drafts: ReceiptDraft[], userId: string, imagePath: string) {
  if (!drafts.length) throw new Error("Add at least one receipt before saving.");
  if (new Set(drafts.map((row) => row.id)).size !== drafts.length) throw new Error("Duplicate receipt IDs.");
  return drafts.map((draft, index) => {
    const fail = (message: string): never => { throw new Error(`Receipt ${index + 1}: ${message}`); };
    const total = Number(draft.total);
    if (!draft.total.trim() || !Number.isFinite(total) || total <= 0 || total > 99999999.99 || Math.abs(total * 100 - Math.round(total * 100)) >= 1e-6) fail("enter an amount greater than zero with at most two decimal places.");
    if (draft.date && !validDate(draft.date)) fail("enter a valid date.");
    if (draft.currency && draft.currency !== "THB") fail("only THB is supported; remove this receipt from the batch.");
    if (!draft.currency && !draft.confirmedThb) fail("confirm the original receipt is in THB.");
    return {
      id: draft.id, user_id: userId, shop_name: draft.shopName.trim() || null,
      receipt_date: draft.date || null, total, currency: "THB", category_id: draft.categoryId || null,
      image_path: imagePath, note: draft.note.trim() || null, ai_confidence: draft.confidence,
    };
  });
}

export type ReceiptBatch = ReturnType<typeof buildReceiptBatch>;

export function classifyBatch(expected: string[], found: string[]): "all" | "none" | "partial" {
  const ids = new Set(found);
  const count = expected.filter((id) => ids.has(id)).length;
  return count === expected.length && expected.length > 0 ? "all" : count === 0 ? "none" : "partial";
}

// IDs and values come from a frozen snapshot. One insert request, never a per-row loop.
export async function saveReceiptBatch(rows: ReceiptBatch, transport: {
  find: (ids: string[]) => Promise<string[]>;
  insert: (rows: ReceiptBatch) => Promise<void>;
}) {
  if (!rows.length) throw new Error("No receipts to save.");
  const ids = rows.map((row) => row.id);
  const before = classifyBatch(ids, await transport.find(ids));
  if (before === "all") return;
  if (before === "partial") throw new Error("Only part of this batch exists. Please check your receipts before continuing.");
  let insertFailure: unknown;
  try { await transport.insert(rows); } catch (error) { insertFailure = error; }
  const after = classifyBatch(ids, await transport.find(ids));
  if (after === "all") return;
  if (after === "partial") throw new Error("Only part of this batch was found. Please check your receipts before continuing.");
  throw new Error(insertFailure instanceof Error ? insertFailure.message : "Save was not confirmed. Retry to check the same batch safely.");
}
