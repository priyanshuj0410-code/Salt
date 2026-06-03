-- 0064: Operator-console admin actions for the OCR queue.
-- Implements the M5 actions of prd-gemma-ocr-worker.md. Run after 0063.
--
-- Salt admins read every org's jobs (0062 admin RLS) but have no UPDATE policy, so the
-- console's retry / escalate / cancel / re-prioritise go through these SECURITY DEFINER
-- RPCs, each gated by is_salt_admin(). Called with the admin's JWT, so auth.uid() (and
-- thus is_salt_admin()) resolves correctly.

begin;

-- Re-queue a failed/stuck job fresh on its current lane (resets attempts + error).
create or replace function public.ocr_admin_retry(p_job_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salt_admin() then raise exception 'not authorized'; end if;
  update public.invoice_scans
    set status = 'pending', attempts = 0, worker_id = null, leased_at = null,
        lease_expires_at = null, error = null, queued_at = now(), updated_at = now()
  where id = p_job_id and status in ('failed', 'pending', 'processing', 'leased', 'superseded');
end;
$$;

-- Force a job onto the paid flash lane now (cross-org; unlike ocr_request_instant this
-- is admin-gated, not member-gated). Re-queues it hot for the Flash driver.
create or replace function public.ocr_admin_escalate(p_job_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salt_admin() then raise exception 'not authorized'; end if;
  update public.invoice_scans
    set lane = 'flash', status = 'pending', priority = greatest(priority, 100),
        worker_id = null, leased_at = null, lease_expires_at = null,
        queued_at = now(), escalated_at = now(), updated_at = now()
  where id = p_job_id and status not in ('extracted', 'posted', 'duplicate');
end;
$$;

-- Cancel a job (terminal, no result) — e.g. junk upload clogging the queue.
create or replace function public.ocr_admin_cancel(p_job_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salt_admin() then raise exception 'not authorized'; end if;
  update public.invoice_scans
    set status = 'superseded', worker_id = null, lease_expires_at = null,
        error = 'cancelled by admin', updated_at = now()
  where id = p_job_id and status not in ('posted');
end;
$$;

-- Re-prioritise (higher = leased first within a lane).
create or replace function public.ocr_admin_set_priority(p_job_id uuid, p_priority int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salt_admin() then raise exception 'not authorized'; end if;
  update public.invoice_scans set priority = p_priority, updated_at = now() where id = p_job_id;
end;
$$;

revoke all on function public.ocr_admin_retry(uuid)             from public;
revoke all on function public.ocr_admin_escalate(uuid)          from public;
revoke all on function public.ocr_admin_cancel(uuid)            from public;
revoke all on function public.ocr_admin_set_priority(uuid, int) from public;
grant execute on function public.ocr_admin_retry(uuid)             to authenticated;
grant execute on function public.ocr_admin_escalate(uuid)          to authenticated;
grant execute on function public.ocr_admin_cancel(uuid)            to authenticated;
grant execute on function public.ocr_admin_set_priority(uuid, int) to authenticated;

commit;
