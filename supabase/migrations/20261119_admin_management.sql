-- Admins manage admins from the app; the viewer role is dropped (only member / admin now).
--
--   club_members()          admins only: everyone who signed up, with their admin flag
--   set_admin(user, bool)   admins only: make someone an admin, or remove it
--                           (the last admin can't be removed, so the club is never left without one)
-- Both are security definer because members can only read their own club_roles row.

delete from public.club_roles where role <> 'admin';
alter table public.club_roles drop constraint club_roles_role_check;
alter table public.club_roles add constraint club_roles_role_check check (role = 'admin');

-- "Sees the whole club" is now the same as being an admin.
create or replace function public.can_see_club()
returns boolean language sql stable security invoker set search_path = '' as $$
  select public.is_admin();
$$;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('submitted', 'resubmitted', 'approved', 'rejected', 'paid', 'over_budget', 'role'));

create or replace function public.club_members()
returns table (id uuid, display_name text, email text, is_admin boolean, joined_at timestamptz, receipts bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.club_roles r where r.user_id = (select auth.uid()) and r.role = 'admin') then
    raise exception 'Only club admins can see the member list.' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, p.email, (r.user_id is not null), p.created_at,
           (select count(*) from public.receipts x where x.user_id = p.id)
    from public.profiles p
    left join public.club_roles r on r.user_id = p.id and r.role = 'admin'
    order by (r.user_id is not null) desc, coalesce(nullif(btrim(p.display_name), ''), p.email);
end;
$$;

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
    insert into public.club_roles (user_id, role) values (target, 'admin') on conflict (user_id) do nothing;
    if found then
      insert into public.notifications (user_id, kind, title, body)
        values (target, 'role', 'You''re now a club admin', 'You can check receipts, pay members back and see club reports.');
    end if;
  else
    -- Lock the admin rows so two admins removing each other at once can't leave zero.
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

revoke execute on function public.club_members(), public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.club_members(), public.set_admin(uuid, boolean) to authenticated;
