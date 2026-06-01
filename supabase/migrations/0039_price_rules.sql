-- 0039: customer pricing rules + resolver (SALT-010).
-- Charge customer-specific prices instead of always MRP, with the winning rule
-- exposed so billing can show the "why". This is the DB half: a price_rules
-- table and a pure (side-effect-free) resolver. The sticky manual override is a
-- billing-client concern. Group pricing reuses ledgers.customer_group (0032).
-- Money integer paise; RLS is_member. Run after 0038.

-- 1. price_rules --------------------------------------------------------------
create table public.price_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  shop_id uuid references public.shops (id) on delete cascade,   -- null = all shops
  -- party scope: a specific party OR a customer_group; both null = all parties
  party_id uuid references public.ledgers (id) on delete cascade,
  customer_group text,                                            -- matches ledgers.customer_group
  -- item scope: a specific item OR an HSN; both null = all items
  item_id uuid references public.items (id) on delete cascade,
  hsn text,
  rule_type text not null check (rule_type in ('pct_off_mrp', 'flat_price_paise', 'margin_target')),
  rule_value numeric not null default 0,   -- pct off (10 = 10%), flat paise, or target margin %
  label text,                              -- human "why" shown on the bill line
  priority integer not null default 0,     -- higher wins
  starts_on date,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index price_rules_org_idx on public.price_rules (org_id);
create index price_rules_party_idx on public.price_rules (party_id);
create index price_rules_item_idx on public.price_rules (item_id);

alter table public.price_rules enable row level security;
create policy "price_rules read"   on public.price_rules for select using (public.is_member(org_id));
create policy "price_rules insert" on public.price_rules for insert with check (public.is_member(org_id));
create policy "price_rules update" on public.price_rules for update using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "price_rules delete" on public.price_rules for delete using (public.is_member(org_id));

-- 2. resolve_price ------------------------------------------------------------
-- Returns the effective unit price (paise) + the winning rule (id + label, the
-- "why") for a party/item, highest priority wins, falling back to MRP when no
-- rule matches. Pure read (STABLE), no side effects. p_mrp_paise / p_cost_paise
-- let billing pass the exact batch MRP/cost being sold; omitted, a representative
-- value is taken across the item's batches. p_shop_id scopes shop-specific rules
-- (when null, only shop-agnostic rules match).
create or replace function public.resolve_price(
  p_party_id uuid,
  p_item_id uuid,
  p_shop_id uuid default null,
  p_mrp_paise bigint default null,
  p_cost_paise bigint default null
) returns table (price_paise bigint, rule_id uuid, rule_label text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid; v_group text; v_hsn text; v_mrp bigint; v_cost bigint; v_price bigint;
  v_rule public.price_rules%rowtype;
begin
  select org_id into v_org from public.memberships where user_id = auth.uid() limit 1;
  if v_org is null then raise exception 'no organization for current user'; end if;

  if p_party_id is not null then
    select customer_group into v_group from public.ledgers where id = p_party_id and org_id = v_org;
  end if;
  select hsn into v_hsn from public.items where id = p_item_id and org_id = v_org;

  -- base MRP / cost: caller override, else representative across the item's batches
  v_mrp  := coalesce(p_mrp_paise,  (select max(mrp_paise) from public.batches where item_id = p_item_id and org_id = v_org));
  v_cost := coalesce(p_cost_paise, (select max(ptr_paise) from public.batches where item_id = p_item_id and org_id = v_org));

  -- highest-priority active, in-window, matching rule (most specific breaks ties)
  select * into v_rule from public.price_rules r
   where r.org_id = v_org and r.active
     and (r.starts_on is null or r.starts_on <= current_date)
     and (r.ends_on   is null or r.ends_on   >= current_date)
     and (r.shop_id is null or r.shop_id = p_shop_id)
     and (r.party_id is null or r.party_id = p_party_id)
     and (r.customer_group is null or r.customer_group = v_group)
     and (r.item_id is null or r.item_id = p_item_id)
     and (r.hsn is null or r.hsn = v_hsn)
   order by r.priority desc,
            (r.party_id is not null) desc, (r.item_id is not null) desc,
            (r.customer_group is not null) desc, (r.hsn is not null) desc,
            r.created_at desc
   limit 1;

  if not found then
    return query select v_mrp, null::uuid, 'MRP'::text;   -- no rule → MRP
    return;
  end if;

  if v_rule.rule_type = 'flat_price_paise' then
    v_price := round(v_rule.rule_value)::bigint;
  elsif v_rule.rule_type = 'pct_off_mrp' then
    v_price := round(coalesce(v_mrp, 0) * (100.0 - v_rule.rule_value) / 100.0)::bigint;
  elsif v_rule.rule_type = 'margin_target' then
    v_price := round(coalesce(v_cost, 0) * (100.0 + v_rule.rule_value) / 100.0)::bigint;  -- margin over cost
  else
    v_price := v_mrp;
  end if;
  if v_price < 0 then v_price := 0; end if;   -- never negative (MRP ceiling is the owner's responsibility)

  return query select v_price, v_rule.id, coalesce(nullif(v_rule.label, ''), v_rule.rule_type);
end; $$;

grant execute on function public.resolve_price(uuid, uuid, uuid, bigint, bigint) to authenticated;
