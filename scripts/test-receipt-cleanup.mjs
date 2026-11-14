import assert from "node:assert/strict";
import { inspectOrphans, isOldUnlinked } from "./receipt-cleanup-dry-run.mjs";
const now = Date.parse("2026-11-14T12:00:00Z");
const old = { id: "object", name: "old.jpg", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };
assert.equal(isOldUnlinked(old, false, now - 48 * 3600000), true);
assert.equal(isOldUnlinked(old, true, now), false);
assert.equal(isOldUnlinked({ ...old, updated_at: new Date(now).toISOString() }, false, now - 48 * 3600000), false);
assert.equal(isOldUnlinked({ ...old, created_at: null }, false, now), false);
const fake = {
  storage: { from: () => ({ list: async (prefix) => ({ data: prefix ? [old, { ...old, name: "saved.jpg" }] : [{ name: "user" }], error: null }) }) },
  from: () => ({ select: () => ({ eq: (_column, value) => ({ limit: async () => ({ data: value.endsWith("saved.jpg") ? [{ id: "receipt" }] : [], error: null }) }) }) }),
};
assert.deepEqual(await inspectOrphans(fake, 48, now), ["user/old.jpg"]);
await assert.rejects(() => inspectOrphans(fake, 1, now));
const broken = { ...fake, from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: new Error("offline") }) }) }) }) };
await assert.rejects(() => inspectOrphans(broken, 48, now));
console.log("Cleanup protects linked/recent/unknown objects and fails closed (offline).");
