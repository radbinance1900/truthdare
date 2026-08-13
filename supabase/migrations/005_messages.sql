-- Run once in Supabase Dashboard > SQL Editor.
-- Chat messages for real-time player communication.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (player_id, room_id) references public.players(id, room_id)
);

create index messages_room_id_created_at_idx on public.messages (room_id, created_at desc);

alter table public.messages enable row level security;

create policy "Players may see messages in their own room"
on public.messages for select to authenticated
using (exists (
  select 1 from public.players p
  where p.room_id = messages.room_id and p.auth_user_id = auth.uid()
));

create policy "Players may insert messages in their own room"
on public.messages for insert to authenticated
with check (exists (
  select 1 from public.players p
  where p.room_id = messages.room_id and p.auth_user_id = auth.uid() and p.id = messages.player_id
));

-- Allow live UI updates for messages.
alter publication supabase_realtime add table public.messages;