-- 0049: publish `batches` to supabase_realtime — live counter stock (SALT-217, unblocks SALT-179).
--
-- The billing counter subscribes to batch changes (lib/realtime `subscribeTableChanges`, wired in
-- BillingScreen by #185) so one counter's sale reflects on siblings' search + FEFO without a reload.
-- Today `batches` is NOT in the publication, so that subscription receives nothing; this adds it.
--
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the full row (incl. org_id), which the client
-- filters on (`org_id=eq.…`) and which RLS needs to evaluate per-row. Read access stays governed by
-- the existing `batches` is_member RLS, so a member only receives their org's batch changes.

alter table public.batches replica identity full;

do $$
begin
  -- idempotent: only add if not already published (re-runnable).
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'batches'
  ) then
    alter publication supabase_realtime add table public.batches;
  end if;
end $$;
