// Shared UI helpers: category colours and icons, money and date formatting,
// and a one-shot "flash" message that survives a page change (e.g. "Saved").
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Receipt } from "@/lib/types";

export const ICONS = {
  food: "M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z M16 10h1.5a2.5 2.5 0 0 1 0 5H16 M8.5 3.5v2 M11.5 3.5v2",
  transport: "M5 17h14 M5 17v-5l2-5h10l2 5v5 M5 12h14 M7.5 20v-3 M16.5 20v-3",
  equipment: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z M3 7.5 12 12l9-4.5 M12 12v9",
  printing: "M7 9V3h10v6 M7 17H4v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6h-3 M7 13h10v8H7z",
  venue: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  other: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  back: "M15 5 8 12l7 7",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5 10 17 19 7.5",
  chevron: "M9 5l7 7-7 7",
  camera: "M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  upload: "M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16 M12 15V4 M7.5 8.5 12 4l4.5 4.5",
  logout: "M14 4h3.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14 M10 16l4-4-4-4 M14 12H4",
  sun: "M12 3.5V2 M12 22v-1.5 M3.5 12H2 M22 12h-1.5 M6 6 4.9 4.9 M19.1 19.1 18 18 M6 18l-1.1 1.1 M19.1 4.9 18 6 M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18 M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.7 3.4 M6.4 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.3-1.1 M9.9 9.9a3 3 0 0 0 4.2 4.2",
  mail: "M3.5 6.5h17v11a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z M3.5 7l8.5 6.5L20.5 7",
  warn: "M12 4 2.8 19.5h18.4z M12 10v4 M12 17v.01",
  file: "M6 3h8l4 4v14H6z M14 3v4h4",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z M10 20.5a2 2 0 0 0 4 0",
  inbox: "M3.5 13.5 6 5h12l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.5a6.5 6.5 0 0 1 3.5 5.5",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M21.5 20h-19",
  home: "M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z",
  plus: "M12 5v14 M5 12h14",
  download: "M12 4v11 M7.5 10.5 12 15l4.5-4.5 M4 19.5h16",
  pencil: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  flag: "M5 21V4 M5 4h11l-2 4 2 4H5",
} as const;

type CategoryStyle = { color: string; icon: string; short: string };

// Design palette for the six default categories (DB names → look).
const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  "Food & Drinks": { color: "#22D27F", icon: ICONS.food, short: "Food" },
  Transport: { color: "#0EB6F2", icon: ICONS.transport, short: "Transport" },
  Equipment: { color: "#C38BFA", icon: ICONS.equipment, short: "Equipment" },
  "Printing & Stationery": { color: "#FFB34F", icon: ICONS.printing, short: "Printing" },
  Venue: { color: "#FF8A65", icon: ICONS.venue, short: "Venue" },
  Other: { color: "#BDBDB6", icon: ICONS.other, short: "Other" },
};

const UNCATEGORISED: CategoryStyle = { color: "#BDBDB6", icon: ICONS.other, short: "No category" };

export function categoryStyle(name?: string | null, fallbackColor?: string | null): CategoryStyle {
  if (!name) return UNCATEGORISED;
  return CATEGORY_STYLES[name] ?? { color: fallbackColor || UNCATEGORISED.color, icon: ICONS.other, short: name };
}

const moneyFmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,700.00" */
export function money(n: number) {
  return moneyFmt.format(n);
}

/** ["1,700", ".00"] for big-number layouts */
export function moneyParts(n: number): [string, string] {
  const s = money(n);
  const i = s.lastIndexOf(".");
  return [s.slice(0, i), s.slice(i)];
}

export function shortDate(iso: string | null) {
  if (!iso) return "No date";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function longDate(iso: string | null) {
  if (!iso) return "No date";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Plain-words version of Gemini's 0–1 confidence for non-technical users. */
export function scanCheck(confidence: number | null) {
  if (confidence === null) return null;
  if (confidence >= 0.8) return { text: "Read clearly", dot: "#22D27F" };
  if (confidence >= 0.5) return { text: "Partly unclear", dot: "#FFB34F" };
  return { text: "Hard to read", dot: "#FF6A5E" };
}

// ---------- Flash message across a navigation ----------
/** month: open Home on this "YYYY-MM"; ids: rows to highlight; scanNext: offer "Scan next". */
export type Flash = { text: string; undoRow?: Receipt; month?: string; ids?: string[]; scanNext?: boolean };
const FLASH_KEY = "rs-flash";

export function setFlash(flash: Flash) {
  try { sessionStorage.setItem(FLASH_KEY, JSON.stringify(flash)); } catch { /* storage blocked: skip the toast */ }
}

// ---------- Remember which month Home was showing ----------
const MONTH_KEY = "rs-month";
export function rememberMonth(ym: string) {
  try { sessionStorage.setItem(MONTH_KEY, ym); } catch { /* not remembered */ }
}
export function recallMonth(): string | null {
  try {
    const v = sessionStorage.getItem(MONTH_KEY);
    return v && /^\d{4}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** "YYYY-MM" → "October" (adds the year when it isn't this year). */
export function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const sameYear = y === new Date().getFullYear();
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", sameYear ? { month: "long" } : { month: "long", year: "numeric" });
}

/** Today as "YYYY-MM-DD" in the user's own time zone. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- "Other" with a name the user types ----------
const PERSONAL_COLORS = ["#FF8FB1", "#7BDFF2", "#B8E986", "#F7D046", "#A0A7FF", "#FFB4A2"];

type CategoryRow = { id: string; name: string; user_id: string | null };

/**
 * The user picked "Other" and typed what it was. Reuse a category with that name
 * if one exists (theirs or a default), otherwise create a personal one.
 */
export async function categoryForOther(client: SupabaseClient, userId: string, typed: string, existing: CategoryRow[]) {
  const name = typed.trim().replace(/\s+/g, " ").slice(0, 40);
  const match = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (match) return { id: match.id, created: null };
  const color = PERSONAL_COLORS[[...name].reduce((h, ch) => h + ch.charCodeAt(0), 0) % PERSONAL_COLORS.length];
  const { data, error } = await client.from("categories").insert({ name, user_id: userId, color }).select("id, name, user_id").single<CategoryRow>();
  if (error || !data) throw new Error(`Couldn't add the category "${name}". Try again.`);
  return { id: data.id, created: { ...data, color } };
}

export function isDefaultOther(c: { name: string; user_id: string | null } | undefined) {
  return !!c && c.user_id === null && c.name === "Other";
}

export function takeFlash(): Flash | null {
  try {
    const raw = sessionStorage.getItem(FLASH_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(FLASH_KEY);
    return JSON.parse(raw) as Flash;
  } catch {
    return null;
  }
}
