-- 0003: Guard so a user cannot create more than one org (matches the
-- onboarding model: each user owns exactly one org for now). Names are NOT
-- globally unique on purpose — different shops may share a name across cities.
-- Run in the Supabase SQL editor after 0002.

create or replace function public.create_org(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'You already belong to an organization';
  end if;
  insert into public.orgs (name, created_by) values (p_name, auth.uid())
  returning id into new_org;
  insert into public.memberships (org_id, user_id, role)
  values (new_org, auth.uid(), 'owner');
  return new_org;
end; $$;
