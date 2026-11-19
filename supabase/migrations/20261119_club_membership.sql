-- Who is in the club. Signing up no longer means you can use the app.
--
--   fast path : your verified email is on the club's allowed list (from the contact list) -> active right away
--   fallback  : any other email -> pending until an admin approves it
--
--   pending  --approve-->  active  --remove-->  removed  --reactivate-->  active
--      |                     ^
--      +--decline--> rejected --ask again (after 24 h)--> pending
--
-- Only ACTIVE members can upload, scan (costs Gemini money), add categories or send receipts.
-- Removed members can still sign in and see their own past receipts, read-only.
-- Their open receipts stay in the treasurer's queue and can still be paid back.
-- Admins see a badge for waiting requests, plus one summary notification a day (09:00 Bangkok).

-- ---------- Tables ----------
create table public.memberships (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'removed')),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  digest_sent_at timestamptz  -- set once this request was in an admin's daily summary
);
create index memberships_status_idx on public.memberships (status);
alter table public.memberships enable row level security;
revoke insert, update, delete, truncate on public.memberships from anon, authenticated;
create policy "see own membership" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));
create policy "admins see all memberships" on public.memberships for select to authenticated
  using ((select public.is_admin()));

-- Everyone already using the app stays in; admins remove test accounts by hand.
insert into public.memberships (user_id, status, decided_at)
  select id, 'active', now() from public.profiles
  on conflict (user_id) do nothing;

create table public.club_allowlist (
  email    text primary key check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  added_at timestamptz not null default now()
);
alter table public.club_allowlist enable row level security;
revoke insert, update, delete, truncate on public.club_allowlist from anon, authenticated;
create policy "admins see allowed emails" on public.club_allowlist for select to authenticated
  using ((select public.is_admin()));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'submitted', 'resubmitted', 'approved', 'rejected', 'paid', 'over_budget', 'role', 'membership', 'join_requests'));

-- New sign-ups start as pending right away, so they show up for admins even before they open the app.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  insert into public.memberships (user_id, status) values (new.id, 'pending') on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------- Who counts as an active member ----------
create or replace function public.is_active_member()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.memberships where user_id = (select auth.uid()) and status = 'active');
$$;
revoke execute on function public.is_active_member() from public, anon;
grant execute on function public.is_active_member() to authenticated;

-- ---------- Only active members may create or change things ----------
drop policy "add own" on public.receipts;
create policy "add own as active member" on public.receipts for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));

drop policy "change own, or review as admin" on public.receipts;
create policy "change own as active member, or review as admin" on public.receipts for update to authenticated
  using ((user_id = (select auth.uid()) and (select public.is_active_member())) or (select public.is_admin()))
  with check ((user_id = (select auth.uid()) and (select public.is_active_member())) or (select public.is_admin()));

drop policy "delete own while open, or own as admin" on public.receipts;
create policy "delete own as active member while open, or own as admin" on public.receipts for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_member())
         and (status in ('pending', 'rejected') or (select public.is_admin())));

drop policy "insert own categories" on public.categories;
create policy "insert own categories as active member" on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_member()));

drop policy "own receipt images insert" on storage.objects;
create policy "own receipt images insert as active member" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = ((select auth.uid()))::text
              and (select public.is_active_member()));

-- ---------- Helpers (security definer: they read auth.users or write for others) ----------
create or replace function public.notify_membership(target uuid, new_status text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, title, body)
  select target, 'membership',
    case new_status when 'active' then 'You''re in the club'
                    when 'rejected' then 'Your request to join was declined'
                    else 'You''re no longer an active member' end,
    case new_status when 'active' then 'You can now scan receipts and send them to the treasurer.'
                    when 'rejected' then 'Ask a club admin if this is a mistake. You can ask again after 24 hours.'
                    else 'You can still see your past receipts. Receipts already sent will still be paid back.' end
  where new_status in ('active', 'rejected', 'removed');
$$;
revoke execute on function public.notify_membership(uuid, text) from public, anon, authenticated;

-- Called by the app after sign-in. Creates your membership row, and takes the fast path
-- when your VERIFIED email is on the allowed list (checked on both sides: here, and when an admin adds emails).
create or replace function public.claim_membership()
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  mail text;
  verified boolean;
  listed boolean;
  cur text;
begin
  if me is null then raise exception 'Please sign in.' using errcode = '42501'; end if;
  select lower(u.email), u.email_confirmed_at is not null into mail, verified from auth.users u where u.id = me;
  listed := verified and exists (select 1 from public.club_allowlist a where a.email = mail);

  select m.status into cur from public.memberships m where m.user_id = me;
  if cur is null then
    insert into public.memberships (user_id, status, decided_at)
      values (me, case when listed then 'active' else 'pending' end, case when listed then now() end)
      on conflict (user_id) do nothing;
    select m.status into cur from public.memberships m where m.user_id = me;
  elsif cur in ('pending', 'rejected') and listed then
    update public.memberships set status = 'active', decided_at = now(), decided_by = null where user_id = me;
    cur := 'active';
  end if;
  return cur;
end;
$$;

-- Declined people may ask again, but at most once a day.
create or replace function public.request_membership()
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  m record;
begin
  select * into m from public.memberships where user_id = me;
  if not found then return 'pending'; end if;
  if m.status <> 'rejected' then return m.status; end if;
  if m.decided_at > now() - interval '24 hours' then
    raise exception 'You can ask again after %.', to_char((m.decided_at + interval '24 hours') at time zone 'Asia/Bangkok', 'DD Mon HH24:MI')
      using errcode = '22023';
  end if;
  update public.memberships
    set status = 'pending', requested_at = now(), decided_by = null, decided_at = null, digest_sent_at = null
    where user_id = me;
  return 'pending';
end;
$$;

-- Admins: approve, decline, remove, reactivate.
create or replace function public.set_membership(target uuid, new_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  cur text;
  admins int;
begin
  if not exists (select 1 from public.club_roles r where r.user_id = me and r.role = 'admin') then
    raise exception 'Only club admins can change memberships.' using errcode = '42501';
  end if;
  select status into cur from public.memberships where user_id = target for update;
  if cur is null then raise exception 'That person was not found.' using errcode = '22023'; end if;
  if (cur, new_status) not in (('pending', 'active'), ('pending', 'rejected'), ('rejected', 'active'),
                               ('active', 'removed'), ('removed', 'active')) then
    raise exception 'Can''t change a % member to %.', cur, new_status using errcode = '22023';
  end if;

  if new_status = 'removed' and exists (select 1 from public.club_roles where user_id = target) then
    perform 1 from public.club_roles where role = 'admin' for update;
    select count(*) into admins from public.club_roles where role = 'admin';
    if admins <= 1 then
      raise exception 'This is the last admin. Make someone else an admin first.' using errcode = '22023';
    end if;
    delete from public.club_roles where user_id = target;  -- leaving the club also ends admin rights
  end if;

  update public.memberships set status = new_status, decided_by = me, decided_at = now() where user_id = target;
  perform public.notify_membership(target, new_status);
end;
$$;

-- Admins paste emails from the contact list. People already waiting with one of those
-- (verified) emails are let in straight away. Removed members are NOT reactivated by this:
-- that needs an explicit Reactivate, so re-pasting an old list can't bring someone back by accident.
create or replace function public.add_allowed_emails(emails text[])
returns json language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  added int;
  activated int;
  r record;
begin
  if not exists (select 1 from public.club_roles cr where cr.user_id = me and cr.role = 'admin') then
    raise exception 'Only club admins can change the allowed emails.' using errcode = '42501';
  end if;
  with clean as (
    select distinct lower(btrim(e)) as email from unnest(emails) e
    where lower(btrim(e)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ), ins as (
    insert into public.club_allowlist (email, added_by) select email, me from clean
    on conflict (email) do nothing returning 1
  ) select count(*) into added from ins;

  activated := 0;
  for r in
    select m.user_id from public.memberships m join auth.users u on u.id = m.user_id
    where m.status in ('pending', 'rejected') and u.email_confirmed_at is not null
      and lower(u.email) in (select a.email from public.club_allowlist a)
  loop
    update public.memberships set status = 'active', decided_by = me, decided_at = now() where user_id = r.user_id;
    perform public.notify_membership(r.user_id, 'active');
    activated := activated + 1;
  end loop;
  return json_build_object('added', added, 'activated', activated);
end;
$$;

-- Taking an email off the list only stops future fast-path sign-ups; current members stay.
create or replace function public.remove_allowed_email(target text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.club_roles cr where cr.user_id = (select auth.uid()) and cr.role = 'admin') then
    raise exception 'Only club admins can change the allowed emails.' using errcode = '42501';
  end if;
  delete from public.club_allowlist where email = lower(btrim(target));
end;
$$;

-- Member list for the admin page now includes the membership status.
drop function public.club_members();
create function public.club_members()
returns table (id uuid, display_name text, email text, is_admin boolean, status text,
               requested_at timestamptz, decided_at timestamptz, joined_at timestamptz, receipts bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.club_roles r where r.user_id = (select auth.uid()) and r.role = 'admin') then
    raise exception 'Only club admins can see the member list.' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, p.email, (r.user_id is not null), coalesce(m.status, 'pending'),
           m.requested_at, m.decided_at, p.created_at,
           (select count(*) from public.receipts x where x.user_id = p.id)
    from public.profiles p
    left join public.club_roles r on r.user_id = p.id and r.role = 'admin'
    left join public.memberships m on m.user_id = p.id
    order by (r.user_id is not null) desc, coalesce(nullif(btrim(p.display_name), ''), p.email);
end;
$$;

revoke execute on function public.claim_membership(), public.request_membership(), public.set_membership(uuid, text),
  public.add_allowed_emails(text[]), public.remove_allowed_email(text), public.club_members() from public, anon;
grant execute on function public.claim_membership(), public.request_membership(), public.set_membership(uuid, text),
  public.add_allowed_emails(text[]), public.remove_allowed_email(text), public.club_members() to authenticated;

-- ---------- Daily summary for admins ----------
-- One notification per admin per day, only when NEW requests came in since the last summary.
create or replace function public.membership_digest()
returns void language plpgsql security definer set search_path = '' as $$
declare
  fresh int;
  waiting int;
begin
  select count(*) filter (where digest_sent_at is null), count(*) into fresh, waiting
    from public.memberships where status = 'pending';
  if fresh = 0 then return; end if;
  insert into public.notifications (user_id, kind, title, body)
    select r.user_id, 'join_requests',
      case when waiting = 1 then '1 person is waiting to join' else waiting || ' people are waiting to join' end,
      'Open Members to let them in or decline.'
    from public.club_roles r where r.role = 'admin';
  update public.memberships set digest_sent_at = now() where status = 'pending' and digest_sent_at is null;
end;
$$;
revoke execute on function public.membership_digest() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('membership-digest', '0 2 * * *', 'select public.membership_digest()');  -- 02:00 UTC = 09:00 Bangkok

-- Only active members can be made admin: making a waiting or removed person admin would skip approval.
create or replace function public.set_admin(target uuid, make_admin boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  admins int;
begin
  if not exists (select 1 from public.club_roles r where r.user_id = me and r.role = 'admin') then
    raise exception 'Only club admins can change who is an admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target) then
    raise exception 'That member was not found.' using errcode = '22023';
  end if;

  if make_admin then
    if not exists (select 1 from public.memberships m where m.user_id = target and m.status = 'active') then
      raise exception 'Let them into the club first, then make them an admin.' using errcode = '22023';
    end if;
    insert into public.club_roles (user_id, role) values (target, 'admin') on conflict (user_id) do nothing;
    if found then
      insert into public.notifications (user_id, kind, title, body)
        values (target, 'role', 'You''re now a club admin', 'You can check receipts, pay members back and see club reports.');
    end if;
  else
    perform 1 from public.club_roles where role = 'admin' for update;
    select count(*) into admins from public.club_roles where role = 'admin';
    if admins <= 1 and exists (select 1 from public.club_roles where user_id = target) then
      raise exception 'The club needs at least one admin. Make someone else an admin first.' using errcode = '22023';
    end if;
    delete from public.club_roles where user_id = target;
    if found then
      insert into public.notifications (user_id, kind, title, body)
        values (target, 'role', 'You''re no longer a club admin', 'You can still send your own receipts as before.');
    end if;
  end if;
end;
$$;
