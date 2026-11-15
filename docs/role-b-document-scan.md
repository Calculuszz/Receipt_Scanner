# Role B: document scan integration

## Behavior

The scan page requests camera access automatically on entry and when returning to the empty state. It prefers the rear camera and shows live video plus Take photo and scan. Upload file is the only alternative entry action and supports images/PDF. Browsers may still require a permission prompt or block automatic camera access; then upload remains available. Camera tracks stop after selection/capture and on unmount, including delayed permission responses. HTTPS or localhost is required. Real-device permission and rotation checks remain pending.

The upload button accepts one image or PDF and starts scanning immediately. Images become JPEG with a long side at most 1600 px. PDFs remain original documents, limited to 5 MiB (5242880 bytes); the app does not claim to enforce a PDF page-count limit. MIME and PDF magic header checks are input checks, not proof that a PDF is readable. Encrypted/corrupt files may fail in Gemini.

Waiting states show a spinner and status text. One review section is created for each detected receipt, not necessarily each page. Users may correct fields, remove false detections or add a missing receipt. Empty results never invent records. Confidence remains internal and is not displayed. Source page references are AI-provided context, not verified or stored in a separate database column.

## API contract change

Authenticated POST /api/scan accepts `{ imagePath }`. It validates ownership, downloads the file using the user's Supabase session and sends native PDF or image bytes to Gemini. Response: `{ receipts: [{ shop_name, receipt_date, total, currency, category, confidence, source_pages }] }`. Other callers expecting a single receipt must migrate. A receipt can have null unreadable fields. Explicit non-THB currency is retained for visible rejection in review, never silently converted; remove that section to save the THB subset. Unknown currency requires user confirmation.

## Save all

All reviewed sections are validated before any write. The entire batch is submitted in ONE Supabase insert request, relying on PostgREST's database transaction per request (not one request per row). Row IDs and field values are kept stable after the first attempt. A status check before and after submission uses all expected IDs under the current user. All found: confirmed saved; none found: same frozen batch may retry; subset found: stop and ask for investigation. A query failure never permits a blind new batch. Frozen retry state is in memory; after closing/reloading the tab, users should inspect the expenses page at / before rescanning to avoid a new duplicate batch.

Redirect to / occurs only after the full batch is confirmed. This checkout already uses / for the Expenses page. The existing Expenses implementation must fetch current data, and any cached server data must be invalidated by the owning integration. Missing auth redirects to /login; temporary login and session-debug controls have been removed. Integration depends on Role A's real login page and cookie-based Supabase session.

## PDF bucket migration — Role C

Apply `supabase/migrations/20261115_receipts_pdf_mime.sql` to the team's existing project before trying PDF uploads. It appends application/pdf while preserving existing types, private flag, size and policies; rerunning is safe. If the bucket is missing, it raises an error. The updated schema.sql includes PDF for fresh setup. Neither file was executed against the live database by this change.

Multiple receipts share one original PDF path. Role C's detail page must open PDFs as documents via an authorized signed URL, not render them with img. Do not remove a shared PDF until no saved receipt references it. The cleanup script remains dry-run only.

## Verification

Offline: TypeScript, scoped lint, receipt validation test, receipt batch test, cleanup test and production build. The batch test mocks a lost response, stable-ID retry, partial result and database-query failure. File preparation tests verify PDF pass-through, oversize rejection and image sizing with a mocked canvas; they do not prove browser decoding or OCR accuracy.

Manual integration: real login; image and multi-page PDF; blank page; two receipts on one page; encrypted/corrupt PDF; no receipts; unknown and foreign currency; change/remove sections; one-click Save all; failed/uncertain save; two-account isolation; cancel cleanup; shared-source retention; mobile keyboard/upload; Expenses page navigation and updated list. Confirm that selecting a file makes one automatic scan request and that progress remains visible.

Source: https://ai.google.dev/gemini-api/docs/generate-content/document-processing
Transaction reference: https://docs.postgrest.org/en/stable/references/transactions.html
