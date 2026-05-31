/**
 * Paginated PostgREST fetch for the report pages. PostgREST caps a response at
 * ~1000 rows; a month-range register / line pull can exceed that, so we page with
 * `.range()` until a short page comes back. The caller supplies a `page(from,to)`
 * that builds the query and applies `.range` — keeping the typed query shape in
 * the page, and the looping here.
 *
 * `page` is typed `PromiseLike<unknown>` (every supabase query builder satisfies
 * it) because supabase-js infers to-one embeds as arrays; the page's row type `T`
 * is the runtime-correct shape, so we assert the response here, mirroring the
 * `as unknown as Row[]` the GST pages use.
 */

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Fetch every row of a query, paging in `pageSize` chunks. Throws on error. */
export async function fetchAllPaged<T>(
  page: (from: number, to: number) => PromiseLike<unknown>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = (await page(offset, offset + pageSize - 1)) as PageResult<T>;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
