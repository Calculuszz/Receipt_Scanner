// Shared types
import type { Tables, TablesInsert, TablesUpdate } from "./database.types";

export type { Database } from "./database.types";

// Database rows (match supabase/schema.sql)
export type Receipt = Tables<"receipts">;
export type ReceiptInsert = TablesInsert<"receipts">;
export type ReceiptUpdate = TablesUpdate<"receipts">;
export type Category = Tables<"categories">;
export type Profile = Tables<"profiles">;
export type ClubEvent = Tables<"events">;
export type AppNotification = Tables<"notifications">;
export type ReceiptStatus = "pending" | "approved" | "rejected" | "paid";

// Default categories seeded in the database (user_id is null)
export const CATEGORY_NAMES = [
  "Food & Drinks",
  "Transport",
  "Equipment",
  "Printing & Stationery",
  "Venue",
  "Other",
] as const;
export type CategoryName = (typeof CATEGORY_NAMES)[number];

// Private Storage bucket for receipt photos; files go under `${userId}/...`
export const RECEIPTS_BUCKET = "receipts";

// Response of POST /api/scan (agreed in the team doc); null = Gemini could not read it
export type ScanResult = {
  shop_name: string | null;
  receipt_date: string | null; // YYYY-MM-DD
  total: number | null;
  currency: string | null;
  category: CategoryName | null;
  confidence: number | null; // 0 to 1
};
