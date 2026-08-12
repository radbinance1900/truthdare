-- Run once in Supabase Dashboard > SQL Editor.
-- Expired rooms cascade-delete their players and rounds.
create or replace function public.delete_expired_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.rooms where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- For testing or manual cleanup in the SQL editor, run:
-- select public.delete_expired_rooms();
--
-- To automate later, schedule this function daily using Supabase Cron / pg_cron
-- if it is available on your project.
