/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test harness for TypeScript helpers. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const path = require("node:path");
require.extensions[".ts"] = (mod, filename) => {
  const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  mod._compile(js, filename);
};
const { buildReceiptBatch, classifyBatch, saveReceiptBatch } = require(path.resolve("lib/receipt-batch.ts"));
const { normalizeDocument, scanWarning } = require(path.resolve("lib/receipt-validation.ts"));
const { prepareReceiptFile } = require(path.resolve("lib/receipt-file.ts"));
const draft = (id) => ({ id, shopName: "Shop", date: "2026-11-15", total: "93", currency: "THB", confirmedThb: false, categoryId: "", note: "", sourcePages: [1], confidence: null });

async function main() {
  const rows = buildReceiptBatch([draft("a"), draft("b")], "owner", "owner/document.pdf");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].image_path, rows[1].image_path);
  assert.throws(() => buildReceiptBatch([], "u", "u/file"));
  assert.throws(() => buildReceiptBatch([draft("a"), { ...draft("b"), total: "0" }], "u", "u/file"));
  assert.throws(() => buildReceiptBatch([{ ...draft("a"), currency: "USD" }], "u", "u/file"));
  assert.throws(() => buildReceiptBatch([{ ...draft("a"), currency: null }], "u", "u/file"));
  assert.equal(buildReceiptBatch([{ ...draft("a"), currency: null, confirmedThb: true }], "u", "u/file")[0].currency, "THB");
  assert.equal(classifyBatch(["a", "b"], ["a"]), "partial");
  let stored = [], writes = 0;
  const transport = { find: async () => stored, insert: async (input) => { writes++; stored = input.map((r) => r.id); throw new Error("lost response"); } };
  await saveReceiptBatch(rows, transport);
  await saveReceiptBatch(rows, transport);
  assert.equal(writes, 1, "retry must not insert confirmed rows twice");
  writes = 0;
  await assert.rejects(() => saveReceiptBatch(rows, { find: async () => ["a"], insert: async () => { writes++; } }), /part/);
  assert.equal(writes, 0);
  stored = [];
  await assert.rejects(() => saveReceiptBatch(rows, { find: async () => [], insert: async () => { throw new Error("offline"); } }), /offline/);
  await saveReceiptBatch(rows, { find: async () => stored, insert: async (input) => { assert.deepEqual(input.map((r) => r.id), ["a", "b"]); stored = input.map((r) => r.id); } });
  await assert.rejects(() => saveReceiptBatch(rows, { find: async () => { throw new Error("unknown status"); }, insert: async () => assert.fail("must not write") }), /unknown/);
  assert.deepEqual(normalizeDocument({ receipts: [] }), { receipts: [] });
  assert.equal(normalizeDocument({ receipts: [{ total: 1 }, { total: 2, currency: "USD", source_pages: [1, 2, -1, "3", 2] }] }).receipts[1].currency, "USD");
  assert.deepEqual(normalizeDocument({ receipts: [{ source_pages: [1, 2, -1, "3", 2] }] }).receipts[0].source_pages, [1, 2]);
  assert.throws(() => normalizeDocument({ shop_name: "old contract" }));
  assert.throws(() => normalizeDocument({ receipts: [null] }));
  assert.equal(scanWarning(0.49), "Hard to read. Check every field against the photo.");
  assert.equal(scanWarning(0.5), "Partly unclear. Check the details against the photo.");
  assert.equal(scanWarning(0.799), "Partly unclear. Check the details against the photo.");
  assert.equal(scanWarning(0.8), null);
  assert.equal(scanWarning(null), null);
  global.createImageBitmap = async () => { throw new Error("unsupported"); };
  await assert.rejects(() => prepareReceiptFile(new File(["image"], "photo.heic", { type: "image/heic" })), /ยังไม่รองรับ HEIC/);
  await assert.rejects(() => prepareReceiptFile(new File(["image"], "photo.jpg", { type: "image/jpeg" })), /Cannot open this image/);
  const pdf = new File(["%PDF-1.7 test"], "receipt.pdf", { type: "application/pdf" });
  assert.equal((await prepareReceiptFile(pdf)).blob, pdf);
  await assert.rejects(() => prepareReceiptFile(new File(["bad"], "bad.pdf", { type: "application/pdf" })), /PDF/);
  await assert.rejects(() => prepareReceiptFile(new File([new Uint8Array(5242881)], "big.pdf", { type: "application/pdf" })), /5 MB/);
  for (const [width, height] of [[4000, 3000], [2000, 6000], [800, 600]]) {
    let closed = false;
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: "" }), toBlob: (cb) => cb(new Blob(["jpeg"], { type: "image/jpeg" })) };
    global.createImageBitmap = async () => ({ width, height, close() { closed = true; } });
    global.document = { createElement: () => canvas };
    await prepareReceiptFile(new File(["image"], "a.jpg", { type: "image/jpeg" }));
    assert.ok(Math.max(canvas.width, canvas.height) <= 1600);
    assert.ok(canvas.width <= width && canvas.height <= height);
    assert.equal(closed, true);
  }
  console.log("Batch reconciliation, multi-receipt validation, PDF handling and resize bounds passed (offline).");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
