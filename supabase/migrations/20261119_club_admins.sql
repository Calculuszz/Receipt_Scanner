-- Club admins (e.g. the treasurer) can READ every member's receipts, files, names and categories.
-- They cannot edit or delete other people's receipts: the existing "own ..." policies still decide writes.
-- Admins live in their own table with no write policies, so nobody can promote themselves through the API.
-- Add an admin in the SQL editor:  insert into public.club_admins (user_id) values ('<auth user id>');

create table public.club_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.club_admins enable row level security;
revoke insert, update, delete, truncate on public.club_admins from anon, authenticated;
create policy "see own admin flag" on public.club_admins
  for select to authenticated using (user_id = (select auth.uid()));

-- security invoker is enough: everyone may read their own club_admins row, and that policy doesn't call is_admin().
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.club_admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create policy "admins read all receipts" on public.receipts
  for select to authenticated using ((select public.is_admin()));
create policy "admins read all profiles" on public.profiles
  for select to authenticated using ((select public.is_admin()));
create policy "admins read all categories" on public.categories
  for select to authenticated using ((select public.is_admin()));
create policy "admins read all receipt files" on storage.objects
  for select to authenticated using (bucket_id = 'receipts' and (select public.is_admin()));
