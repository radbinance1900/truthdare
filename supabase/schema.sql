-- Twogether MVP schema
-- Run this whole file in: Supabase Dashboard > SQL Editor > New query.

create extension if not exists pgcrypto;

create type public.room_status as enum ('lobby', 'playing', 'ended');
create type public.game_mode as enum ('truth', 'dare', 'would_you_rather', 'couple_trivia');
create type public.round_outcome as enum ('active', 'completed', 'passed', 'rerolled');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique check (join_code ~ '^[A-Z]{4}-[0-9]{2}$'),
  status public.room_status not null default 'lobby',
  host_player_id uuid,
  current_player_id uuid,
  selected_game_mode public.game_mode,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  avatar_seed text not null default encode(gen_random_bytes(8), 'hex'),
  is_host boolean not null default false,
  is_ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, auth_user_id),
  unique (id, room_id)
);

alter table public.rooms
  add constraint rooms_host_player_in_room
    foreign key (host_player_id, id) references public.players(id, room_id) deferrable initially deferred,
  add constraint rooms_current_player_in_room
    foreign key (current_player_id, id) references public.players(id, room_id) deferrable initially deferred;

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  game_mode public.game_mode not null,
  category text not null check (char_length(category) between 1 and 40),
  text text not null check (char_length(text) between 1 and 280),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  prompt_id uuid not null references public.prompts(id),
  outcome public.round_outcome not null default 'active',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (player_id, room_id) references public.players(id, room_id)
);

create index rooms_expires_at_idx on public.rooms (expires_at);
create index players_room_id_idx on public.players (room_id);
create index rounds_room_id_idx on public.rounds (room_id, created_at desc);
create index prompts_active_mode_idx on public.prompts (game_mode) where active;

-- The client never writes game state directly. Server-side actions added later
-- will use a server-only key to create rooms and advance turns safely.
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.prompts enable row level security;
alter table public.rounds enable row level security;

create policy "Players may see their own room"
on public.rooms for select to authenticated
using (exists (
  select 1 from public.players p
  where p.room_id = rooms.id and p.auth_user_id = auth.uid()
));

create policy "Players may see players in their own room"
on public.players for select to authenticated
using (exists (
  select 1 from public.players self
  where self.room_id = players.room_id and self.auth_user_id = auth.uid()
));

create policy "Players may see active prompts"
on public.prompts for select to authenticated
using (active = true);

create policy "Players may see their own room rounds"
on public.rounds for select to authenticated
using (exists (
  select 1 from public.players p
  where p.room_id = rounds.room_id and p.auth_user_id = auth.uid()
));

-- Allow live UI updates for rooms, players and turns.
alter publication supabase_realtime add table public.rooms, public.players, public.rounds;

-- A small, safe starter prompt pack. More prompts can be added later.
insert into public.prompts (game_mode, category, text) values
  ('truth', 'storytime', 'What is a tiny moment from this week that made you smile?'),
  ('truth', 'favorites', 'What is a comfort food you could happily eat any day?'),
  ('truth', 'memories', 'What is a funny memory you still laugh about?'),
  ('dare', 'creative', 'Draw a tiny picture of the other player in 30 seconds.'),
  ('dare', 'silly', 'Invent a two-line theme song for today.'),
  ('dare', 'kindness', 'Give the other player three specific compliments.'),
  ('would_you_rather', 'travel', 'Would you rather take a quiet cabin trip or explore a busy new city?'),
  ('would_you_rather', 'funny', 'Would you rather have a pet dragon the size of a cat or a cat the size of a dragon?'),
  ('couple_trivia', 'favorites', 'What do you think is the other player’s ideal weekend breakfast?'),
  ('couple_trivia', 'memories', 'What shared moment would the other player put in a time capsule?');
