-- CardDex 0.19 — esquema optimizado Supabase/PostgreSQL
-- Ejecutar una vez en el SQL editor del proyecto Supabase.

create extension if not exists pgcrypto;

-- Si vienes de CardDex 0.18, estas líneas eliminan las copias JSON de las cartas.
-- La información pública de cada carta se reconstruye desde TCGdex usando card_id.
alter table if exists public.collection_items drop column if exists card_data;
alter table if exists public.wishlist_items drop column if exists card_data;
alter table if exists public.goal_cards drop column if exists card_data;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Entrenador',
  avatar_pokemon_id integer not null default 25 check (avatar_pokemon_id between 1 and 1025),
  avatar_style text not null default 'pixel' check (avatar_style in ('pixel','icon')),
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table if not exists public.wishlist_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table if not exists public.goals (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.goal_cards (
  goal_id text not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  added_at timestamptz not null default now(),
  primary key (goal_id, card_id)
);

alter table public.profiles enable row level security;
alter table public.collection_items enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.goals enable row level security;
alter table public.goal_cards enable row level security;

-- Cada usuario solo ve/modifica sus propios datos.
drop policy if exists "profiles own rows" on public.profiles;
create policy "profiles own rows" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "collection own rows" on public.collection_items;
create policy "collection own rows" on public.collection_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "wishlist own rows" on public.wishlist_items;
create policy "wishlist own rows" on public.wishlist_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "goals own rows" on public.goals;
create policy "goals own rows" on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "goal cards own rows" on public.goal_cards;
create policy "goal cards own rows" on public.goal_cards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Perfil automático al registrarse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'Entrenador'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create index if not exists idx_collection_user on public.collection_items(user_id);
create index if not exists idx_wishlist_user on public.wishlist_items(user_id);
create index if not exists idx_goals_user on public.goals(user_id);
create index if not exists idx_goal_cards_user on public.goal_cards(user_id);
