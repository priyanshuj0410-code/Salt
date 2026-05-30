/**
 * Fetch every row of a Supabase query, paging past PostgREST's default
 * 1000-row cap. Pass a builder that applies `.range(from, to)` to your select:
 *
 *   const rows = await selectAll<Row>((from, to) =>
 *     supabase.from("items").select("id,item_code").eq("org_id", orgId).range(from, to),
 *   );
 *
 * Without this, large orgs (e.g. ~7,900 items) only ever see the first 1,000
 * rows — which silently breaks code-joins, the billing catalogue, etc.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
