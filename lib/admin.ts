import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, ReceiptStatus } from "@/lib/types";

/** member: sends receipts. admin: the treasurer (there can be several); reviews, pays back, manages admins. */
export type Role = "member" | "admin";
export type Me = { id: string; role: Role; admin: boolean };

/**
 * Who is signed in, and what is their club role?
 * The UI only uses this to show or hide things; the database (RLS + triggers) is what actually allows or blocks.
 */
export async function loadMe(client: SupabaseClient): Promise<Me | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data } = await client.from("club_roles").select("role").eq("user_id", user.id).maybeSingle();
  const role: Role = data?.role === "admin" ? "admin" : "member";
  return { id: user.id, role, admin: role === "admin" };
}

/** A short, friendly name for a member: display name, else the part of the email before @. */
export function memberName(p: Pick<Profile, "display_name" | "email"> | null | undefined) {
  return p?.display_name?.trim() || p?.email?.split("@")[0] || "Member";
}

/** How each review status looks and reads. Colours work on both themes. */
export const STATUS: Record<ReceiptStatus, { label: string; short: string; dot: string; bg: string; fg: string }> = {
  pending: { label: "Waiting for the treasurer", short: "Checking", dot: "#F5A524", bg: "var(--warn-bg)", fg: "var(--warn-text)" },
  rejected: { label: "Sent back: please fix it", short: "Sent back", dot: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 14%, transparent)", fg: "var(--danger)" },
  approved: { label: "Approved, waiting to be paid back", short: "Approved", dot: "#0EB6F2", bg: "color-mix(in srgb, #0EB6F2 16%, transparent)", fg: "var(--text)" },
  paid: { label: "Paid back", short: "Paid", dot: "var(--ok)", bg: "color-mix(in srgb, var(--ok) 16%, transparent)", fg: "var(--ok)" },
};

export function asStatus(s: string | null | undefined): ReceiptStatus {
  return s === "approved" || s === "rejected" || s === "paid" ? s : "pending";
}

/** Quick reasons the treasurer can tap when sending a receipt back. */
export const SEND_BACK_REASONS = [
  "The photo is hard to read. Please retake it.",
  "The amount doesn't match the receipt.",
  "The date is missing or wrong.",
  "This doesn't look like a club expense.",
  "Please pick the event this was for.",
];
