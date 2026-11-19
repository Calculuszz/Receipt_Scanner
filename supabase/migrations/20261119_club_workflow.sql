-- Club workflow: roles, events with budgets, review status, and notifications.
-- Every rule lives here (RLS + triggers), so the app UI cannot be bypassed by calling the API directly.
--
--   member  : sends receipts; edits or deletes them only while pending or sent back
--   admin   : the treasurer; sees everything, approves / sends back / marks paid, manages events.
--             Their own receipts are approved straight away (they paid with club money).
--   viewer  : president or advisor; sees everything, changes nothing
--
-- Give someone a role in the SQL editor:
--   insert into public.club_roles (user_id, role) values ('<auth user id>', 'admin');   -- or 'viewer'

-- ---------- Roles (replaces club_admins) ----------
create table public.club_roles (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  role     text not null check (role in ('admin', 'viewer')),
  added_at timestamptz not null default now()
);
insert into public.club_roles (user_id, role) select user_id, 'admin' from public.club_admins;
alter table public.club_roles enable row level security;
revoke insert, update, delete, truncate on public.club_roles from anon, authenticated;
create policy "see own role" on public.club_roles
  for select to authenticated using (user_id = (select auth.uid()));

drop policy "admins read all receipts" on public.receipts;
drop policy "admins read all profiles" on public.profiles;
drop policy "admins read all categories" on public.categories;
drop policy "admins read all receipt files" on storage.objects;

create or replace function public.is_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.club_roles where user_id = (select auth.uid()) and role = 'admin');
$$;
create or replace function public.can_see_club()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.club_roles where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin(), public.can_see_club() from public, anon;
grant execute on function public.is_admin(), public.can_see_club() to authenticated;

drop table public.club_admins;

create policy "club reads all profiles" on public.profiles
  for select to authenticated using ((select public.can_see_club()));
create policy "club reads all categories" on public.categories
  for select to authenticated using ((select public.can_see_club()));
create policy "club reads all receipt files" on storage.objects
  for select to authenticated using (bucket_id = 'receipts' and (select public.can_see_club()));

-- ---------- Events (projects with an optional budget) ----------
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  budget     numeric(12, 2) check (budget is null or budget >= 0),
  starts_on  date,
  ends_on    date,
  archived   boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
alter table public.events enable row level security;
create policy "everyone reads events" on public.events for select to authenticated using (true);
create policy "admins add events" on public.events for insert to authenticated with check ((select public.is_admin()));
create policy "admins change events" on public.events for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins remove events" on public.events for delete to authenticated using ((select public.is_admin()));

-- ---------- Review status on receipts ----------
alter table public.receipts
  add column event_id    uuid references public.events (id) on delete set null,
  add column status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
  add column review_note text check (review_note is null or char_length(review_note) <= 500),
  add column reviewed_by uuid references auth.users (id) on delete set null,
  add column reviewed_at timestamptz,
  add column paid_at     timestamptz;
create index receipts_status_idx on public.receipts (status);
create index receipts_event_idx on public.receipts (event_id);

-- Receipts saved before this workflow existed count as already checked (without touching updated_at).
alter table public.receipts disable trigger receipts_set_updated_at;
update public.receipts set status = 'approved';
alter table public.receipts enable trigger receipts_set_updated_at;

drop policy "own receipts" on public.receipts;
create policy "read own or whole club" on public.receipts for select to authenticated
  using (user_id = (select auth.uid()) or (select public.can_see_club()));
create policy "add own" on public.receipts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "change own, or review as admin" on public.receipts for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "delete own while not approved" on public.receipts for delete to authenticated
  using (user_id = (select auth.uid()) and status in ('pending', 'rejected'));

-- Who may change what. Runs as the caller, so is_admin() means the person making the change.
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
      new.status := 'approved'; new.reviewed_by := me; new.reviewed_at := now();
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
revoke execute on function public.receipts_guard() from public, anon, authenticated;
create trigger receipts_guard before insert or update on public.receipts
  for each row execute function public.receipts_guard();

-- ---------- Notifications ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  receipt_id uuid references public.receipts (id) on delete cascade,
  event_id   uuid references public.events (id) on delete cascade,
  kind       text not null check (kind in ('submitted', 'resubmitted', 'approved', 'rejected', 'paid', 'over_budget')),
  title      text not null,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
-- Only triggers create notifications; people can read theirs, mark them read, or clear them.
revoke insert, update, truncate on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "read own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notifications" on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- security definer: it writes notifications for other people (admins, the receipt owner).
create or replace function public.receipts_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  who   text;
  label text;
  ev    record;
  spent numeric;
begin
  select coalesce(nullif(btrim(p.display_name), ''), split_part(p.email, '@', 1), 'A member')
    into who from public.profiles p where p.id = new.user_id;
  who := coalesce(who, 'A member');
  label := coalesce(nullif(btrim(new.shop_name), ''), 'Receipt') || ' · ฿' || to_char(new.total, 'FM999,999,990.00');

  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notifications (user_id, receipt_id, kind, title, body)
      select r.user_id, new.id, 'submitted', who || ' sent a receipt to check', label
      from public.club_roles r where r.role = 'admin' and r.user_id <> new.user_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status = 'rejected' and new.status = 'pending' then
      insert into public.notifications (user_id, receipt_id, kind, title, body)
        select r.user_id, new.id, 'resubmitted', who || ' fixed a receipt you sent back', label
        from public.club_roles r where r.role = 'admin' and r.user_id <> new.user_id;
    elsif new.status in ('approved', 'rejected', 'paid') and new.user_id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000') then
      insert into public.notifications (user_id, receipt_id, kind, title, body) values (
        new.user_id, new.id, new.status,
        case new.status
          when 'approved' then 'Receipt approved'
          when 'rejected' then 'Receipt sent back: please fix it'
          else 'You''ve been paid back' end,
        case when new.status = 'rejected' then label || E'\n' || coalesce(new.review_note, '') else label end);
    end if;
  end if;

  -- Tell admins once when this receipt pushes an event over its budget.
  if new.event_id is not null and new.status <> 'rejected' then
    select id, name, budget into ev from public.events where id = new.event_id;
    if ev.budget is not null then
      select coalesce(sum(total), 0) into spent from public.receipts
        where event_id = ev.id and status <> 'rejected';
      if spent > ev.budget and not exists (
        select 1 from public.notifications n where n.event_id = ev.id and n.kind = 'over_budget'
          and n.created_at > now() - interval '1 day') then
        insert into public.notifications (user_id, event_id, receipt_id, kind, title, body)
          select r.user_id, ev.id, new.id, 'over_budget', ev.name || ' is over budget',
                 'Spent ฿' || to_char(spent, 'FM999,999,990.00') || ' of ฿' || to_char(ev.budget, 'FM999,999,990.00')
          from public.club_roles r where r.role = 'admin';
      end if;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.receipts_notify() from public, anon, authenticated;
create trigger receipts_notify after insert or update of status, event_id, total on public.receipts
  for each row execute function public.receipts_notify();

-- Live badge in the app.
alter publication supabase_realtime add table public.notifications;
