-- Run once in the team's Supabase SQL editor; safe to rerun.
-- Preserve existing MIME types, size limit, ownership policies and bucket privacy.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'receipts') then
    raise exception 'The receipts bucket does not exist. Create it with the team policies first.';
  end if;

  -- NULL already permits all MIME types; do not narrow an unrestricted bucket.
  update storage.buckets
  set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
  where id = 'receipts'
    and allowed_mime_types is not null
    and not ('application/pdf' = any(allowed_mime_types));
end;
$$;
