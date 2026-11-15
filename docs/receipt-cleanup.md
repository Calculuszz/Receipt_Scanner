# Receipt image cleanup: staged deployment

The browser removes unreferenced images on explicit Cancel, replacement and ordinary scan failure. Browser shutdown, reload, lost upload responses and network interruption can still leave files behind.

## Dry-run preparation

`scripts/receipt-cleanup-dry-run.mjs` recursively lists objects in the private receipts bucket, checks creation and update timestamps, and queries receipts for each old object's image_path. It only reports candidates and has no deletion API call. Database/storage errors abort the run. It skips unknown timestamps and files younger than the grace period.

Supply `NEXT_PUBLIC_SUPABASE_URL` and either `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in a trusted server environment. Never prefix the privileged key with NEXT_PUBLIC, commit it, or put it in a browser component. Optional `RECEIPT_CLEANUP_GRACE_HOURS` defaults to 48 and cannot be less than 24.

With a supported Node version, run from the project root:

```sh
node --env-file=.env.local scripts/receipt-cleanup-dry-run.mjs
```

Do not share output publicly: paths include user IDs. No live dry-run was performed as part of this repair; credentials and remote execution are separate from the offline self-tests.

## Role C handoff before enabling deletion

1. Agree a grace period longer than a normal scan/review session. 48 hours is a proposed starting value, not a deployment decision.
2. Run the dry-run on the team's project. Inspect a sample and confirm saved receipts are absent from the output. Review older manually uploaded test files too.
3. Choose a trusted scheduler that can run the command; run read-only first. Nothing in this change creates a schedule or changes database policies.
4. Before adding deletion, prevent a late Save from referencing an object while cleanup deletes it. Use a server-coordinated draft/claim protocol that makes claiming an image for Save and claiming it for cleanup mutually exclusive. A list of unreferenced files plus a later reference recheck alone is NOT atomic.
5. Only after that protocol, retention agreement and dry-run review should a deletion mode be implemented, approved, and enabled. Delete through Supabase Storage API, not by removing storage database rows.

Until enabled, this is an inspection tool and preparation for scheduled cleanup; it does not fully resolve abandoned files after tab closure.

## Shared PDF sources

One PDF may produce multiple receipts rows with the same image_path. A saved source must be retained while ANY row refers to it. Deleting one receipt is not permission to remove its PDF. Role C's delete flow must check remaining references; coordinate concurrent save/delete behavior before automating deletion. Draft cancellation and scan failure cleanup use the same any-reference check. Source page numbers shown during review are context only and are not separately persisted in the current receipts schema.
