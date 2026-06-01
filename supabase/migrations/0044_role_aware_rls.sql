-- 0044: role-aware RLS — per-role row permissions (SALT-199, FR-U-012).
-- Until now RLS was org-level only (is_member). Route guards hide owner-only
-- screens in the UI, but a cashier JWT could still read/write owner-only data
-- directly via PostgREST. This adds a has_role() helper and tightens policies so
-- the API enforces the boundary too.
--
-- Boundary (see wiki/architecture/security-rls.md for the full matrix):
--   * OWNER-ONLY (all ops): purchasing, payments, GST, accounting/treasury — the
--     POS never touches these directly, so a cashier loses all access.
--   * OWNER-ONLY WRITES (reads stay is_member): masters + config (parties,
--     catalogue, pricing, series, settings, inventory ops) — the POS/reports
--     still READ them, only owners mutate.
--   * UNCHANGED is_member: the whole sales path (sales_invoices, sale_lines,
--     sale_tenders, h1_register, held_bills, stock_movements, credit_notes,
--     activity_events, …) so the cashier POS flow is unaffected.
--
-- NOTE: SECURITY DEFINER write RPCs (receive_purchase, import RPCs, …) bypass
-- RLS, so a cashier could still invoke them. Gating those RPC bodies on has_role
-- is a follow-on (filed separately) — this migration closes the direct-table hole.
-- Run after 0042. Idempotent (drops existing policies before recreating).

-- 1. has_role(org, role) — mirrors is_member, reads the authoritative membership role
create or replace function public.has_role(p_org uuid, p_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role::text = p_role
  );
$$;
grant execute on function public.has_role(uuid, text) to authenticated;

-- 2. OWNER-ONLY (all ops): drop every existing policy, install one owner gate ---
do $$
declare
  t text; p record;
  owner_all text[] := array[
    'purchases','purchase_lines','purchase_orders','po_lines',
    'payments','payment_allocations','debit_notes','debit_note_lines',
    'gst_returns','gstr2b_imports','gstr2b_lines','gstr2b_matches',
    'journal_vouchers','ledger_entries','chart_accounts',
    'bank_statement_lines','cash_drawer','vendor_schemes'
  ];
begin
  foreach t in array owner_all loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'org_id') then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy %I on public.%I for all using (public.has_role(org_id, %L)) with check (public.has_role(org_id, %L))',
      t || '_owner_all', t, 'owner', 'owner');
  end loop;
end $$;

-- 3. OWNER-ONLY WRITES (reads stay org-level for the POS / reports) ------------
do $$
declare
  t text; p record;
  owner_write text[] := array[
    'ledgers','ledger_bills','items','batches',
    'invoice_series','price_rules','drug_licenses','salesmen',
    'print_templates','org_settings','shop_settings','doctors',
    'item_aliases','item_substitutes',
    'stock_transfers','stock_transfer_lines','physical_counts','physical_count_lines'
  ];
begin
  foreach t in array owner_write loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = 'org_id') then continue; end if;
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select using (public.is_member(org_id))', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (public.has_role(org_id, %L))', t || '_ins', t, 'owner');
    execute format('create policy %I on public.%I for update using (public.has_role(org_id, %L)) with check (public.has_role(org_id, %L))', t || '_upd', t, 'owner', 'owner');
    execute format('create policy %I on public.%I for delete using (public.has_role(org_id, %L))', t || '_del', t, 'owner');
  end loop;
end $$;
