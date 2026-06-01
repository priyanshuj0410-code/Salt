-- Verify brand_aliases after running 0051 then 0052. Read-only — run in the Supabase SQL editor.

-- 1. Row count + distinct brands (expect ~4062 rows, ~3946 distinct brand_key).
select count(*) as rows, count(distinct brand_key) as distinct_brand_keys
from public.brand_aliases;

-- 2. Confidence spread (expect high-verified ~698 / high ~3191 / med ~150 / low ~23).
select confidence, count(*) from public.brand_aliases group by confidence order by count(*) desc;

-- 3. Coverage: rows with a composition vs blank (genuinely-unknown, low-confidence).
select count(*) filter (where composition <> '') as with_composition,
       count(*) filter (where composition =  '') as blank_composition
from public.brand_aliases;

-- 4. Spot-check brand_key lookups — how the importer/enrichment will query.
select brand, manufacturer, composition, category, confidence
from public.brand_aliases
where brand_key in ('lonazep05', 'acitrom2', 'ampanel4', 'azee250')
order by brand_key;

-- 5. Multi-strength brands kept distinct under one key (expected, not a bug):
select brand_key, count(*) as variants, array_agg(composition order by composition) as compositions
from public.brand_aliases
group by brand_key having count(*) > 1
order by variants desc limit 10;

-- 6. RLS sanity: this returns rows for an authenticated session; via PostgREST as anon it must be [].
select count(*) as authenticated_can_read from public.brand_aliases;
