// Turns whatever currency text the AI read off a receipt into an ISO code.
// Thai receipts print baht in many ways (฿, บาท, บ., Bht, THB., "฿ THB", "บาท/Baht"...),
// and an exact-match list used to treat most of them as a foreign currency.

/** Any of these anywhere in the text means Thai baht. */
const BAHT = /฿|บาท|^บ\.?$|\bTHB\b|\bBAHT\b|\bBHT\b|^BT$|^TH$|^B$/i;

const OTHERS: [RegExp, string][] = [
  [/\bUSD\b|US\$|^\$$/i, "USD"],
  [/\bEUR\b|€/i, "EUR"],
  [/\bGBP\b|£/i, "GBP"],
  [/\bJPY\b|円/i, "JPY"],
  [/\bCNY\b|\bRMB\b|元/i, "CNY"],
  [/\bKRW\b|₩/i, "KRW"],
  [/\bSGD\b|S\$/i, "SGD"],
  [/\bMYR\b|^RM$/i, "MYR"],
  [/\bVND\b|₫/i, "VND"],
  [/\bLAK\b|₭|กีบ/i, "LAK"],
  [/\bKHR\b|៛/i, "KHR"],
  [/\bMMK\b|^KS$/i, "MMK"],
  [/\bHKD\b|HK\$/i, "HKD"],
  [/\bTWD\b|NT\$/i, "TWD"],
  [/\bINR\b|₹/i, "INR"],
];

const EMPTY = /^(|-|UNKNOWN|N\/A|NA|NULL|NONE)$/i;

/**
 * "THB" for baht, another ISO code when clearly foreign, null when nothing usable was read.
 * Baht wins if the text mentions it at all (e.g. "฿ / USD rate shown" on a Thai receipt).
 */
export function toCurrencyCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (EMPTY.test(text)) return null;
  if (BAHT.test(text)) return "THB";
  for (const [re, code] of OTHERS) if (re.test(text)) return code;
  // A 3-letter code we don't list (e.g. "AUD") is kept; anything else unreadable is unknown.
  return /^[A-Z]{3}$/i.test(text) ? text.toUpperCase() : null;
}
