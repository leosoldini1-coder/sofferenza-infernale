-- =====================================================================
-- Rullo · schema database (incollare in Supabase → SQL Editor → Run)
-- =====================================================================

-- Profilo di ogni utente (uno per account)
create table if not exists public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  display_name    text,
  ftp             int     not null default 220,
  weight          numeric not null default 73,
  bike            numeric not null default 9,
  icu_athlete_id  text,
  icu_api_key     text,
  auto_strava     boolean not null default true,
  auto_icu        boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- Storico uscite fatte con Rullo
create table if not exists public.activities (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  started_at          timestamptz not null,
  name                text,
  mode                text,
  duration_s          int,
  distance_m          numeric,
  avg_power           int,
  np                  int,
  avg_hr              int,
  kj                  int,
  tss                 int,
  strava_activity_id  bigint,
  icu_activity_id     text,
  created_at          timestamptz not null default now()
);
create index if not exists activities_user_started on public.activities (user_id, started_at desc);

-- Token Strava: leggibili SOLO dalla funzione server (nessuna policy = nessun accesso dal browser)
create table if not exists public.strava_tokens (
  user_id        uuid primary key references auth.users on delete cascade,
  athlete_id     bigint,
  athlete_name   text,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     bigint not null,
  updated_at     timestamptz not null default now()
);

alter table public.profiles      enable row level security;
alter table public.activities    enable row level security;
alter table public.strava_tokens enable row level security;

-- Ognuno vede e modifica solo i propri dati
drop policy if exists "profilo: lettura propria"   on public.profiles;
drop policy if exists "profilo: inserimento proprio" on public.profiles;
drop policy if exists "profilo: modifica propria"  on public.profiles;
create policy "profilo: lettura propria"     on public.profiles for select using (id = auth.uid());
create policy "profilo: inserimento proprio" on public.profiles for insert with check (id = auth.uid());
create policy "profilo: modifica propria"    on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "uscite: proprie" on public.activities;
create policy "uscite: proprie" on public.activities for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Crea il profilo automaticamente alla prima registrazione
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
