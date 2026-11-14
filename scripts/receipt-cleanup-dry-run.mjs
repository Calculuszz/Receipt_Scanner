import { pathToFileURL } from "node:url";

// Fail closed: unknown/malformed timestamps must never become candidates.
export function isOldUnlinked(object, linked, cutoff) {
  const created = Date.parse(object.created_at ?? "");
  const updated = Date.parse(object.updated_at ?? object.created_at ?? "");
  return !linked && Number.isFinite(created) && Number.isFinite(updated)
    && created < cutoff && updated < cutoff;
}

export async function inspectOrphans(client, hours = 48, now = Date.now()) {
  if (!Number.isFinite(hours) || hours < 24) throw new Error("Grace period must be at least 24 hours.");
  const cutoff = now - hours * 3600000;
  const candidates = [];
  async function visit(prefix) {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await client.storage.from("receipts").list(prefix, {
        limit: 100, offset, sortBy: { column: "name", order: "asc" },
      });
      if (error || !data) throw new Error("Could not list receipt objects; review aborted.");
      for (const item of data) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (!item.id) { await visit(path); continue; }
        if (!isOldUnlinked(item, false, cutoff)) continue;
        const { data: receipts, error: lookupError } = await client.from("receipts")
          .select("id").eq("image_path", path).limit(1);
        if (lookupError || !receipts) throw new Error("Could not verify references; review aborted.");
        if (isOldUnlinked(item, receipts.length > 0, cutoff)) candidates.push(path);
      }
      if (data.length < 100) break;
    }
  }
  await visit("");
  return candidates;
}

async function main() {
  if (process.argv.includes("--apply")) throw new Error("This script is dry-run only. No deletion mode has been enabled.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Provide project URL and a server-only privileged key in the execution environment.");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const candidates = await inspectOrphans(client, Number(process.env.RECEIPT_CLEANUP_GRACE_HOURS || 48));
  console.log(JSON.stringify({ mode: "dry-run", count: candidates.length, paths: candidates }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Cleanup review failed. Check server-only credentials, permissions and grace period. No files were deleted."); process.exitCode = 1; });
}
