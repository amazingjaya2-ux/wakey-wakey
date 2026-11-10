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
