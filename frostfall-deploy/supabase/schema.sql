-- ================================================================
-- FROSTFALL REALMS — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New Query
-- ================================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ================================================================
-- PROFILES (extends Supabase auth.users)
-- ================================================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ================================================================
-- WORLDS (each user can have multiple worlds)
-- ================================================================
create table public.worlds (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null default 'Untitled World',
  description text,
  theme_color text default '#f0c040',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_worlds_user on public.worlds(user_id);

-- ================================================================
-- ARTICLES (the core codex entries)
-- ================================================================
create table public.articles (
  id uuid default uuid_generate_v4() primary key,
  world_id uuid references public.worlds on delete cascade not null,
  slug text not null,                    -- URL-friendly ID (e.g. "aerithel")
  title text not null,
  category text not null,                -- deity, race, character, etc.
  summary text,
  fields jsonb default '{}'::jsonb,      -- template fields as key-value
  body text,
  tags text[] default '{}',
  linked_ids text[] default '{}',        -- @mention references
  temporal jsonb,                        -- { type, active_start, active_end, etc. }
  portrait_url text,                     -- URL to uploaded portrait image
  is_archived boolean default false,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(world_id, slug)
);

create index idx_articles_world on public.articles(world_id);
create index idx_articles_category on public.articles(world_id, category);
create index idx_articles_archived on public.articles(world_id, is_archived);

-- Full-text search index
alter table public.articles add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) stored;

create index idx_articles_fts on public.articles using gin(fts);

-- ================================================================
-- STORAGE BUCKET (for portraits and images)
-- ================================================================
-- Run these in SQL editor:
insert into storage.buckets (id, name, public) 
values ('portraits', 'portraits', true)
on conflict (id) do nothing;

-- ================================================================
-- ROW LEVEL SECURITY (RLS)
-- ================================================================

-- Profiles: users can read all, update own
alter table public.profiles enable row level security;
create policy "Public profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Worlds: users can CRUD their own worlds
alter table public.worlds enable row level security;
create policy "Users can view own worlds" on public.worlds for select using (auth.uid() = user_id);
create policy "Users can create worlds" on public.worlds for insert with check (auth.uid() = user_id);
create policy "Users can update own worlds" on public.worlds for update using (auth.uid() = user_id);
create policy "Users can delete own worlds" on public.worlds for delete using (auth.uid() = user_id);

-- Articles: users can CRUD articles in their worlds
alter table public.articles enable row level security;
create policy "Users can view own articles" on public.articles for select
  using (world_id in (select id from public.worlds where user_id = auth.uid()));
create policy "Users can create articles" on public.articles for insert
  with check (world_id in (select id from public.worlds where user_id = auth.uid()));
create policy "Users can update own articles" on public.articles for update
  using (world_id in (select id from public.worlds where user_id = auth.uid()));
create policy "Users can delete own articles" on public.articles for delete
  using (world_id in (select id from public.worlds where user_id = auth.uid()));

-- Storage: users can upload/manage their own portraits
create policy "Users can upload portraits" on storage.objects for insert
  with check (bucket_id = 'portraits' and auth.role() = 'authenticated');
create policy "Anyone can view portraits" on storage.objects for select
  using (bucket_id = 'portraits');
create policy "Users can delete own portraits" on storage.objects for delete
  using (bucket_id = 'portraits' and auth.uid()::text = (storage.foldername(name))[1]);

-- ================================================================
-- HELPER: Update timestamps automatically
-- ================================================================
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_worlds_timestamp before update on public.worlds
  for each row execute function public.update_updated_at();
create trigger update_articles_timestamp before update on public.articles
  for each row execute function public.update_updated_at();
