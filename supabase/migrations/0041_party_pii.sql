-- 0041: GDPR/DPDP right-to-access + right-to-erasure for a party (SALT-188, DB half).
-- export_party_pii returns a party's personal data + their documents/payments,
-- machine-readable. erase_party_pii anonymises the party's PII while PRESERVING
-- the immutable financial ledger (sales_invoices, ledger_entries, payments, …,
-- all party FKs are ON DELETE RESTRICT) for statutory GST retention.
--
-- Erasure must not leak PII into the audit trail: the 0038 audit trigger on
-- ledgers would otherwise capture the original name/phone/etc. into
-- audit_log.before. So audit_capture gains a transaction-local suppress switch,
-- and erase_party_pii toggles it and writes its own sanitized 'erase_pii' entry.
--
-- Owner UI (export download + erase confirm) is the settings lane (frontend),
-- out of this migrations-only scope. Per-party export is distinct from the broad
-- SALT-093 data backup. Money integer paise; org-scoped via is_member. Run after 0040.

-- 1. Teach audit_capture a txn-local suppress switch (cumulative on 0038) ------
create or replace function public.audit_capture()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb; v_old jsonb; v_org uuid; v_shop uuid; v_row uuid;
begin
  -- PII-scrubbing ops set this (txn-local) so they can write their own sanitized
  -- audit row instead of leaking before/after PII here.
  if current_setting('salt.suppress_audit', true) = 'on' then return null; end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  v_org  := coalesce(v_new->>'org_id',  v_old->>'org_id')::uuid;
  v_shop := coalesce(v_new->>'shop_id', v_old->>'shop_id')::uuid;
  v_row  := coalesce(v_new->>'id',      v_old->>'id')::uuid;
  if v_org is null then return null; end if;
  insert into public.audit_log (org_id, shop_id, user_id, action, table_name, row_id, before, after)
  values (v_org, v_shop, auth.uid(), lower(tg_op), tg_table_name, v_row, v_old, v_new);
  return null;
end; $$;

-- 2. export_party_pii: right-to-access, machine-readable -----------------------
create or replace function public.export_party_pii(p_party_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_out jsonb;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not exists (select 1 from public.ledgers where id = p_party_id and org_id = v_org) then
    raise exception 'party not in organization';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'party',          (select to_jsonb(l) from public.ledgers l where l.id = p_party_id and l.org_id = v_org),
    'ledger_bills',   (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.ledger_bills   b  where b.ledger_id = p_party_id and b.org_id = v_org),
    'sales_invoices', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.sales_invoices s  where s.party_id  = p_party_id and s.org_id = v_org),
    'purchases',      (select coalesce(jsonb_agg(to_jsonb(pu)),'[]'::jsonb) from public.purchases      pu where pu.vendor_id = p_party_id and pu.org_id = v_org),
    'credit_notes',   (select coalesce(jsonb_agg(to_jsonb(cn)),'[]'::jsonb) from public.credit_notes   cn where cn.party_id  = p_party_id and cn.org_id = v_org),
    'debit_notes',    (select coalesce(jsonb_agg(to_jsonb(dn)),'[]'::jsonb) from public.debit_notes    dn where dn.vendor_id = p_party_id and dn.org_id = v_org),
    'payments',       (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.payments       p  where p.party_id   = p_party_id and p.org_id = v_org),
    'ledger_entries', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.ledger_entries e  where e.party_id   = p_party_id and e.org_id = v_org)
  ) into v_out;

  return v_out;
end; $$;
grant execute on function public.export_party_pii(uuid) to authenticated;

-- 3. erase_party_pii: right-to-erasure (anonymise, keep postings) --------------
create or replace function public.erase_party_pii(p_party_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;
  if not exists (select 1 from public.ledgers where id = p_party_id and org_id = v_org) then
    raise exception 'party not in organization';
  end if;

  -- Suppress the row audit trigger so the original PII is not written to
  -- audit_log.before; a sanitized entry is logged below instead.
  perform set_config('salt.suppress_audit', 'on', true);
  update public.ledgers set
    name     = '[erased ' || left(p_party_id::text, 8) || ']',
    phone    = null,
    gstin    = null,
    address  = null,
    source   = '{}'::jsonb,   -- raw import row holds verbatim phone/address/GST
    clinical = '{}'::jsonb    -- health PII
  where id = p_party_id and org_id = v_org;
  perform set_config('salt.suppress_audit', 'off', true);

  -- Financial postings (sales_invoices, ledger_entries, payments, purchases,
  -- credit/debit notes, ledger_bills) are intentionally left intact — they
  -- reference the party by id, which now points at the anonymised row.

  insert into public.audit_log (org_id, shop_id, user_id, action, table_name, row_id, before, after)
  values (v_org, null, auth.uid(), 'erase_pii', 'ledgers', p_party_id, null,
          jsonb_build_object('erased', true, 'at', now()));
end; $$;
grant execute on function public.erase_party_pii(uuid) to authenticated;
