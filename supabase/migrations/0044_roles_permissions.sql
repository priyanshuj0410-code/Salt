-- 0044: Per-user permission overrides + role-aware RLS on the financial tables
-- (SALT-174). Depends on the enum values added in 0043 — run 0043 first and let
-- it commit, then run this.
--
-- Model: a member's effective capabilities = the role's defaults (the app's
-- capability map in lib/permissions.ts) PLUS per-user grants/revocations stored
-- in membership_permissions. The app's can() helper reads these rows; this
-- migration enforces the financially sensitive slice in the database so it holds
-- regardless of the client.

-- 1. has_role: does the caller hold one of p_roles in p_org? -----------------
-- Compares role::text so the function body never references the enum *values*
-- directly (keeping it independent of the enum's membership). Security-definer
-- with a fixed search_path, mirroring is_member (0002) — and, like is_member,
-- it scopes to the caller's own membership row, so org isolation is preserved.
create or replace function public.has_role(p_org uuid, p_roles text[])
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org and user_id = auth.uid() and role::text = any(p_roles)
  );
$$;
grant execute on function public.has_role(uuid, text[]) to authenticated;

-- 2. membership_permissions: per-user override of a single capability --------
create table public.membership_permissions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  permission text not null,                   -- a Permission key from lib/permissions.ts
  granted boolean not null,                   -- true = grant on top of role; false = revoke
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (membership_id, permission)
);
create index membership_permissions_membership_idx
  on public.membership_permissions (membership_id);

alter table public.membership_permissions enable row level security;

-- A member may read their own overrides; an owner or manager may read everyone's
-- in their org (org-scoped via the membership join — no cross-org leakage).
create policy "read membership_permissions" on public.membership_permissions
  for select using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_permissions.membership_id
        and (m.user_id = auth.uid() or public.has_role(m.org_id, array['owner', 'manager']))
    )
  );

-- Only an owner may write overrides — assigning capabilities is owner-only. The
-- Users & roles UI (SALT-091) drives these writes.
create policy "owner writes membership_permissions" on public.membership_permissions
  for all using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_permissions.membership_id
        and public.has_role(m.org_id, array['owner'])
    )
  ) with check (
    exists (
      select 1 from public.memberships m
      where m.id = membership_permissions.membership_id
        and public.has_role(m.org_id, array['owner'])
    )
  );

-- 3. Role-aware RLS on the financial "books" --------------------------------
-- The general ledger + bank/cash internals become readable only by
-- owner / manager / accountant. These tables have NO client read path in any
-- cashier or pharmacist flow: posting runs through security-definer RPCs
-- (record_payment, create_sales_invoice -> post_entry / account_id), which
-- bypass RLS, so tightening SELECT introduces no regression. Writes stay at
-- is_member (no direct client write path exists, and the definer RPCs bypass it
-- regardless), keeping the blast radius to reads.
--
-- NOTE: payments and sales_invoices are deliberately LEFT at org-level. The
-- counter credit-limit check (lib/credit.ts) reads both directly, for every
-- member, to compute a party's outstanding; role-gating them needs a
-- server-side credit RPC first (tracked as a follow-up). Restricting them now
-- would silently undercount dues and break the credit warning (SALT-004).

drop policy if exists "ledger_entries read" on public.ledger_entries;
create policy "ledger_entries read" on public.ledger_entries
  for select using (public.has_role(org_id, array['owner', 'manager', 'accountant']));

drop policy if exists "journal_vouchers read" on public.journal_vouchers;
create policy "journal_vouchers read" on public.journal_vouchers
  for select using (public.has_role(org_id, array['owner', 'manager', 'accountant']));

drop policy if exists "chart_accounts read" on public.chart_accounts;
create policy "chart_accounts read" on public.chart_accounts
  for select using (public.has_role(org_id, array['owner', 'manager', 'accountant']));

drop policy if exists "cash_drawer read" on public.cash_drawer;
create policy "cash_drawer read" on public.cash_drawer
  for select using (public.has_role(org_id, array['owner', 'manager', 'accountant']));

drop policy if exists "bank_statement_lines read" on public.bank_statement_lines;
create policy "bank_statement_lines read" on public.bank_statement_lines
  for select using (public.has_role(org_id, array['owner', 'manager', 'accountant']));
