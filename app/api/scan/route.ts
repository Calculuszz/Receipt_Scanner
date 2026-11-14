// Scan API: will send the receipt image to Gemini and save the result (placeholder)
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { normalizeReceipt, RECEIPT_CATEGORIES, UnsupportedCurrencyError } from "@/lib/receipt-validation";

export async function POST(request: Request) {
  try {
    // 1. ตรวจว่าตั้งค่า API key และ model แล้วหรือยัง
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL;

    if (!apiKey || !model) {
      return Response.json(
        { error: "Gemini API key or model is not configured." },
        { status: 500 }
      );
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: "Please log in before scanning." }, { status: 401 });
    }
    const body: unknown = await request.json();
    const imagePath = typeof body === "object" && body !== null && "imagePath" in body ? body.imagePath : null;
    if (typeof imagePath !== "string" || !imagePath.startsWith(`${user.id}/`) || imagePath.slice(user.id.length + 1).includes("/")) {
      return Response.json(
        { error: "Invalid receipt image path." },
        { status: 400 }
      );
    }
    const { data: image, error: downloadError } = await supabase.storage.from("receipts").download(imagePath);
    if (downloadError || !image) return Response.json({ error: "Could not access the receipt image." }, { status: 404 });
    if (!image.type.startsWith("image/") || image.size > 5 * 1024 * 1024) return Response.json({ error: "Invalid receipt image." }, { status: 400 });

    // 3. แปลงไฟล์เป็น Base64 เพื่อส่งให้ Gemini
    const imageBytes = await image.arrayBuffer();
    const base64Image = Buffer.from(imageBytes).toString("base64");

    // 4. สร้าง client และส่งรูปพร้อมคำสั่ง
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          inlineData: {
            mimeType: image.type,
            data: base64Image,
          },
        },
        `Read this receipt. It may be in Thai or English.
Return a JSON object with these fields:
- shop_name: string or null
- receipt_date: string in YYYY-MM-DD format or null
- total: number or null
- currency: string or null
- category: one of "Food & Drinks", "Transport", "Equipment", "Printing & Stationery", "Venue", "Other", or null
- confidence: number from 0 to 1 or null

Convert Buddhist Era years to Gregorian years.
Use the final amount paid after discounts and VAT.
Use null for fields that cannot be read.`,
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            shop_name: { type: Type.STRING, nullable: true },
            receipt_date: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD; null if unreadable" },
            total: { type: Type.NUMBER, nullable: true },
            currency: { type: Type.STRING, nullable: true, description: "Currency printed on the receipt; do not assume THB if unknown" },
            category: { type: Type.STRING, nullable: true, enum: RECEIPT_CATEGORIES },
            confidence: { type: Type.NUMBER, nullable: true },
          },
          required: ["shop_name", "receipt_date", "total", "currency", "category", "confidence"],
        },
      },
    });

    // 5. แปลงข้อความ JSON จาก Gemini แล้วส่งกลับให้หน้าเว็บ
    if (!response.text) {
      throw new Error("Gemini returned an empty response.");
    }

    const result: unknown = JSON.parse(response.text);
    return Response.json(normalizeReceipt(result));
  } catch (error) {
    if (error instanceof UnsupportedCurrencyError) return Response.json({ error: error.message }, { status: 422 });
    console.error("Scan failed:", error);

    return Response.json(
      { error: "Could not scan the receipt." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({ status: "not implemented" }, { status: 501 });
}
