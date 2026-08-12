-- Run once in Supabase Dashboard > SQL Editor.
-- Answers exist only to show them during an active room; expired rooms are
-- removed by the cleanup step later in the roadmap.
alter table public.rounds
  add column if not exists answer_text text check (char_length(answer_text) <= 500),
  add column if not exists answered_at timestamptz;
