-- Follow-up to club_workflow.
-- 1. The treasurer's own receipts were paid with club money: nothing to pay back, so they start as paid.
-- 2. Receipts from before the workflow were already settled: approved -> paid.
-- 3. The treasurer may delete their own receipts at any status.

create or replace function public.receipts_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  me    uuid := (select auth.uid());
  admin boolean := public.is_admin();
  data_changed boolean;
begin
  if me is null then return new; end if; -- SQL editor / service role

  if tg_op = 'INSERT' then
    new.review_note := null; new.reviewed_by := null; new.reviewed_at := null; new.paid_at := null;
    if admin then
      new.status := 'paid'; new.reviewed_by := me; new.reviewed_at := now(); new.paid_at := now();
    else
      new.status := 'pending';
    end if;
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'A receipt cannot move to another member.' using errcode = '42501';
  end if;
  data_changed := (new.shop_name, new.receipt_date, new.total, new.currency, new.category_id,
                   new.image_path, new.note, new.event_id, new.ai_confidence)
       is distinct from (old.shop_name, old.receipt_date, old.total, old.currency, old.category_id,
                   old.image_path, old.note, old.event_id, old.ai_confidence);

  if not admin then
    -- Members: locked once approved; any edit (re)sends it for review.
    if old.status in ('approved', 'paid') then
      raise exception 'This receipt was already %, so it can''t be changed. Ask the treasurer.', old.status using errcode = '42501';
    end if;
    new.status := 'pending';
    new.review_note := old.review_note; new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at; new.paid_at := old.paid_at;
    return new;
  end if;

  -- Admins: may edit their own receipts; on others they only review.
  if old.user_id <> me and data_changed then
    raise exception 'Only the member who sent this receipt can edit it. Send it back with a note instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('pending', 'approved'), ('pending', 'rejected'), ('rejected', 'approved'),
      ('approved', 'paid'), ('approved', 'rejected'), ('approved', 'pending'), ('paid', 'approved')) then
      raise exception 'A receipt can''t go from % to %.', old.status, new.status using errcode = '22023';
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.review_note), '') = '' then
      raise exception 'Add a reason so the member knows what to fix.' using errcode = '22023';
    end if;
    if new.status in ('approved', 'rejected') then new.reviewed_by := me; new.reviewed_at := now(); end if;
    new.paid_at := case when new.status = 'paid' then now() else null end;
  else
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.paid_at := old.paid_at;
  end if;
  return new;
end;
$$;

alter table public.receipts disable trigger receipts_set_updated_at;
alter table public.receipts disable trigger receipts_notify;
update public.receipts set status = 'paid', paid_at = coalesce(paid_at, updated_at) where status = 'approved';
alter table public.receipts enable trigger receipts_notify;
alter table public.receipts enable trigger receipts_set_updated_at;

drop policy "delete own while not approved" on public.receipts;
create policy "delete own while open, or own as admin" on public.receipts for delete to authenticated
  using (user_id = (select auth.uid()) and (status in ('pending', 'rejected') or (select public.is_admin())));
