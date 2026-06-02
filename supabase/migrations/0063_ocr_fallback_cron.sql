-- 0063: OCR queue fallback tick — TAT guarantee via pg_cron + pg_net.
-- Implements M4 of prd-gemma-ocr-worker.md. Run in the Supabase SQL editor after 0062.
--
-- Every ~15 min: reclaim crashed leases, escalate stale free-queue jobs onto the flash
-- lane, and (best-effort) POST to the process-scans Edge Function so Gemini drains those
-- escalated/instant jobs EVEN WHEN EVERY LAPTOP IS OFFLINE. This bounds worst-case cost
-- to "a little Flash" while protecting the ~6h promise.
--
-- §14.4: pg_cron + pg_net availability is project-dependent. This migration always
-- creates the tick FUNCTION; the schedule + http trigger are best-effort — if the
-- extensions or Vault secrets are absent the migration still succeeds and prints a
-- NOTICE with the manual step. Escalated jobs always carry lane='flash', so a worker
-- run with OCR_LANES=queue,flash (or a manual "Fetch now") still drains them.
--
-- ONE-TIME SETUP the user must do for the automatic http trigger (service key stays in
-- Vault, never in app code):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>',                 'service_role_key');

begin;

-- The tick. SECURITY DEFINER so it can run the (definer) reclaim/escalate RPCs, read
-- Vault, and call pg_net. Reclaim/escalate are pure SQL and always run; the http POST
-- is wrapped so a missing pg_net/Vault never breaks them.
create or replace function public.ocr_cron_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pending_flash int;
  v_url text;
  v_key text;
begin
  perform public.ocr_reclaim_expired();
  perform public.ocr_escalate_stale(interval '5 hours');

  select count(*) into v_pending_flash
  from public.invoice_scans where status = 'pending' and lane = 'flash';
  if v_pending_flash = 0 then
    return;
  end if;

  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_url is not null and v_key is not null then
      perform net.http_post(
        url := v_url || '/functions/v1/process-scans',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := '{}'::jsonb,
        timeout_milliseconds := 5000
      );
    end if;
  exception when others then
    -- pg_net not installed or Vault secrets unset: leave the jobs on lane=flash for a
    -- worker (OCR_LANES=queue,flash) or a manual Fetch to drain. Do not fail the tick.
    null;
  end;
end;
$$;

revoke all on function public.ocr_cron_tick() from public;
grant execute on function public.ocr_cron_tick() to service_role;

-- Enable the extensions + (re)schedule the tick. Best-effort: a project without pg_cron
-- still gets the function above; the user wires the schedule once the extension is on.
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  if exists (select 1 from cron.job where jobname = 'ocr-queue-tick') then
    perform cron.unschedule('ocr-queue-tick');
  end if;
  perform cron.schedule('ocr-queue-tick', '*/15 * * * *', 'select public.ocr_cron_tick();');
  raise notice 'Scheduled ocr-queue-tick every 15 min. Set the Vault secrets (see header) so it can trigger the Flash drain.';
exception when others then
  raise notice 'Could not auto-schedule (%). Enable pg_cron + pg_net (Dashboard > Database > Extensions), then run: select cron.schedule(''ocr-queue-tick'', ''*/15 * * * *'', ''select public.ocr_cron_tick();'');', sqlerrm;
end$$;

commit;
