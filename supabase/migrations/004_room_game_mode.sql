-- Run once in Supabase Dashboard > SQL Editor.
alter table public.rooms
  add column if not exists room_game_mode text not null default 'truth_dare'
  check (room_game_mode in ('truth_dare', 'would_you_rather', 'couple_trivia'));
