-- Database schema for Receipt Scanner.
-- This matches the live Supabase project, which has these migrations applied:
--   20261114094638 init_tables_and_rls
--   20261114094651 receipts_storage_bucket
--   20261114094702 revoke_handle_new_user_execute
-- To set up a fresh project, run this whole file in the Supabase SQL editor.
-- If you change the schema, apply the change in Supabase AND update this file
-- (and lib/database.types.ts), then post the change in the group chat.

-- =========================================================
-- PROFILES: one row per user, created by a trigger on sign-up
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Only the trigger should call this function, not API users.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- =========================================================
-- CATEGORIES: user_id null = default category shared by everyone
-- =========================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#64748b',
  user_id uuid references auth.users(id) on delete cascade
);

insert into public.categories (name, color) values
  ('Food & Drinks', '#f97316'),
  ('Transport', '#3b82f6'),
  ('Equipment', '#8b5cf6'),
  ('Printing & Stationery', '#14b8a6'),
  ('Venue', '#eab308'),
  ('Other', '#64748b');

-- =========================================================
-- RECEIPTS: one saved receipt per row, owned by one user
-- =========================================================
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shop_name text,
  receipt_date date,
  total numeric(10,2) not null check (total > 0),
  currency text not null default 'THB',
  category_id uuid references public.categories(id) on delete set null,
  image_path text,          -- path in the "receipts" bucket: {user_id}/<file>
  note text,
  ai_confidence real,       -- Gemini confidence, 0 to 1
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index receipts_user_date_idx on public.receipts (user_id, receipt_date desc);
create index receipts_category_idx on public.receipts (category_id);
create index categories_user_idx on public.categories (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger receipts_set_updated_at
  before update on public.receipts
  for each row execute procedure public.set_updated_at();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.receipts   enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "read default and own categories" on public.categories
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "insert own categories" on public.categories
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "update own categories" on public.categories
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "delete own categories" on public.categories
  for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own receipts" on public.receipts
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- =========================================================
-- STORAGE: private "receipts" bucket, files under {user_id}/
-- Max 5 MB; JPEG, PNG, WebP, HEIC, PDF. Use signed URLs for private files.
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic','application/pdf']);

create policy "own receipt images select" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own receipt images insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own receipt images update" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own receipt images delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
