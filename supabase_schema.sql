-- ════════════════════════════════════════════════════════════
-- ClipStudio — Supabase schema
-- Run this in the Supabase dashboard → SQL Editor → New query.
-- It is idempotent (safe to run more than once).
-- ════════════════════════════════════════════════════════════

-- 1) Calls table -------------------------------------------------
create table if not exists public.calls (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  label            text,
  mode             text,
  duration_seconds numeric,
  audio_url        text,
  created_at       timestamptz not null default now()
);

create index if not exists calls_user_created_idx
  on public.calls (user_id, created_at desc);

-- 2) Row level security -----------------------------------------
alter table public.calls enable row level security;

drop policy if exists "calls_select_own" on public.calls;
create policy "calls_select_own" on public.calls
  for select using (auth.uid() = user_id);

drop policy if exists "calls_insert_own" on public.calls;
create policy "calls_insert_own" on public.calls
  for insert with check (auth.uid() = user_id);

drop policy if exists "calls_update_own" on public.calls;
create policy "calls_update_own" on public.calls
  for update using (auth.uid() = user_id);

drop policy if exists "calls_delete_own" on public.calls;
create policy "calls_delete_own" on public.calls
  for delete using (auth.uid() = user_id);

-- 3) Keep only the most recent 100 calls per user ----------------
-- The client also prunes after each insert; this trigger is a
-- server-side safety net so the cap holds no matter what.
create or replace function public.enforce_max_calls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.calls
  where id in (
    select id from public.calls
    where user_id = new.user_id
    order by created_at desc
    offset 100
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_max_calls on public.calls;
create trigger trg_enforce_max_calls
  after insert on public.calls
  for each row execute function public.enforce_max_calls();

-- 4) Storage bucket for recorded audio --------------------------
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', true)
on conflict (id) do nothing;

-- Allow authenticated users to manage files inside their own
-- "<user_id>/..." folder; anyone can read (bucket is public).
drop policy if exists "recordings_read" on storage.objects;
create policy "recordings_read" on storage.objects
  for select using (bucket_id = 'recordings');

drop policy if exists "recordings_insert_own" on storage.objects;
create policy "recordings_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'recordings'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "recordings_update_own" on storage.objects;
create policy "recordings_update_own" on storage.objects
  for update using (
    bucket_id = 'recordings'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "recordings_delete_own" on storage.objects;
create policy "recordings_delete_own" on storage.objects
  for delete using (
    bucket_id = 'recordings'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
