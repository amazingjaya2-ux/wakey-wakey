-- MileMoney cloud sync schema for Supabase.
-- Run once in your Supabase project: Dashboard > SQL Editor > New query > paste > Run.

-- Every shift, expense and settings object is one row. `data` holds the record as JSON,
-- so new app fields never need a database migration.
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  kind       text        not null check (kind in ('shift', 'expense', 'settings')),
  data       jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists records_user_updated on public.records (user_id, updated_at);

-- Row level security: each signed-in user can only see and change their own rows.
alter table public.records enable row level security;
drop policy if exists "Users manage their own records" on public.records;
create policy "Users manage their own records" on public.records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The server stamps every write, so devices can ask "what changed since X?".
create or replace function public.records_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.records_touch();

-- In-app account deletion (required by the App Store and Google Play).
-- Deleting the auth user also deletes their records through the foreign key cascade.
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Pro: receipt photos. Private bucket; each user can only touch files under
-- their own folder: receipts/<user id>/<expense id>.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "Receipts: read own" on storage.objects;
create policy "Receipts: read own" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Receipts: add own" on storage.objects;
create policy "Receipts: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Receipts: replace own" on storage.objects;
create policy "Receipts: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Receipts: delete own" on storage.objects;
create policy "Receipts: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Pro: AI receipt scanner usage counter (daily limit per user). Only the
-- scan-receipt edge function (service role) can call this; the app cannot.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default current_date,
  scans   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security; -- no policies: invisible to app users

create or replace function public.bump_ai_usage(p_user uuid) returns integer
language sql security definer set search_path = '' as $$
  insert into public.ai_usage (user_id, day, scans) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set scans = public.ai_usage.scans + 1
  returning scans;
$$;
revoke all on function public.bump_ai_usage(uuid) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid) to service_role;
