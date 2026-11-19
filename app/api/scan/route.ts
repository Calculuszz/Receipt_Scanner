import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { normalizeDocument, RECEIPT_CATEGORIES } from "@/lib/receipt-validation";
import { MAX_RECEIPT_BYTES, RECEIPT_MIME_TYPES } from "@/lib/receipt-file";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Please log in before scanning." }, { status: 401 });
    // Every scan costs Gemini money: only people the club has let in may use it.
    const { data: active } = await supabase.rpc("is_active_member");
    if (active !== true) return Response.json({ error: "Only club members can scan. Wait for a club admin to let you in." }, { status: 403 });
    let body: unknown;
    try { body = await request.json(); }
    catch { return Response.json({ error: "Send JSON containing imagePath." }, { status: 400 }); }
    const imagePath = typeof body === "object" && body !== null && "imagePath" in body ? body.imagePath : null;
    if (typeof imagePath !== "string" || !imagePath.startsWith(`${user.id}/`) || !imagePath.slice(user.id.length + 1) || imagePath.slice(user.id.length + 1).includes("/")) return Response.json({ error: "Invalid receipt file path." }, { status: 400 });
    const { data: document, error: downloadError } = await supabase.storage.from("receipts").download(imagePath);
    if (downloadError || !document) return Response.json({ error: "Could not access this receipt file." }, { status: 404 });
    if (!RECEIPT_MIME_TYPES.includes(document.type) || !document.size || document.size > MAX_RECEIPT_BYTES) return Response.json({ error: "Use a supported image or PDF no larger than 5 MB." }, { status: 400 });
    if (document.type === "application/pdf" && new TextDecoder().decode(await document.slice(0, 5).arrayBuffer()) !== "%PDF-") return Response.json({ error: "Invalid PDF document." }, { status: 400 });
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;
    if (!apiKey || !model) return Response.json({ error: "Gemini is not configured." }, { status: 503 });
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [
        { inlineData: { mimeType: document.type, data: Buffer.from(await document.arrayBuffer()).toString("base64") } },
        `Extract ALL distinct shop receipts in this image or PDF in source order. Receipts may be Thai or English.
Return an object with a receipts array. Return [] if there are no receipts. Each entry is one receipt, not a line item.
A page may have zero, one or several receipts. Combine pages that belong to one receipt. Never invent entries to match a page count.
Extract shop_name, receipt_date (YYYY-MM-DD; subtract 543 from Buddhist Era years), total (final amount paid after VAT and discounts), currency, currency_inferred, category, confidence and source_pages (one-based page numbers; [] if unknown).
Currency: answer an ISO 4217 code, never a symbol. Thai baht is printed as ฿, บาท, บ., Baht, Bht or THB: all of these are "THB".
If a currency is printed, use it and set currency_inferred false. Never convert amounts between currencies.
If no currency is printed but the receipt is clearly Thai (Thai text, a Thai tax ID or address, PromptPay), answer "THB" with currency_inferred true.
Otherwise use null. A "$" alone on a Thai receipt is not proof of USD: check the language and address first.
Use null for unreadable fields. Categories: ${RECEIPT_CATEGORIES.join(", ")}.`,
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT, required: ["receipts"], properties: {
            receipts: { type: Type.ARRAY, items: {
              type: Type.OBJECT,
              properties: {
                shop_name: { type: Type.STRING, nullable: true },
                receipt_date: { type: Type.STRING, nullable: true },
                total: { type: Type.NUMBER, nullable: true },
                currency: { type: Type.STRING, nullable: true },
                currency_inferred: { type: Type.BOOLEAN },
                category: { type: Type.STRING, nullable: true, enum: RECEIPT_CATEGORIES },
                confidence: { type: Type.NUMBER, nullable: true },
                source_pages: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              },
              required: ["shop_name", "receipt_date", "total", "currency", "currency_inferred", "category", "confidence", "source_pages"],
            } },
          },
        },
      },
    });
    if (!response.text) throw new Error("Empty AI response");
    return Response.json(normalizeDocument(JSON.parse(response.text)));
  } catch (error) {
    console.error("Receipt document scan failed:", error);
    return Response.json({ error: "Could not read this document. Retry, or use a clear image or a readable, unencrypted PDF." }, { status: 502 });
  }
}
