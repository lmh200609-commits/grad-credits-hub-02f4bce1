// Fetch all rows from a Supabase query, bypassing the default 1000-row limit
// by paginating with .range(). Use for queries that may return >1000 rows
// (e.g. large user/profile/application tables).
import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";

const PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAll<T>(builder: PostgrestFilterBuilder<any, any, T[], any, any>): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await builder.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
