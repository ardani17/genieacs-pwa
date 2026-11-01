// Device list query building for the browser: search text becomes a
// NATIVE expression AST (parse/stringify from the engine parser), never
// a hand-built query string. Filter changes reset page to 1, lengths
// stay <=8192 and the URL round-trips.
import {
  parse,
  stringify,
} from "../../../../../lib/common/expression/parser.ts";
import type { Expression } from "@contracts/api.ts";

export const SEARCH_MAX_LENGTH = 256;
export const FILTER_MAX_LENGTH = 8192;

export interface ListQuery {
  page: number;
  pageSize: 25 | 50 | 100;
  filter: Expression | null;
  sort: Record<string, 1 | -1>;
}

// Free text -> OR over identity fields, quoted so punctuation, slashes
// and Unicode stay literal.
export function buildSearchExpression(text: string): Expression {
  const trimmed = text.trim().slice(0, SEARCH_MAX_LENGTH);
  if (!trimmed) return null;
  const needle = JSON.stringify(trimmed).slice(1, -1); // escape quotes/backslashes
  return [
    "OR",
    ["LIKE", ["PARAM", "DeviceID.ID"], `%${needle}%`],
    ["LIKE", ["PARAM", "DeviceID.SerialNumber"], `%${needle}%`],
    ["LIKE", ["PARAM", "_tags"], `%${needle}%`],
  ];
}

export interface RawQueryParams {
  page?: string | null;
  pageSize?: string | null;
  sort?: string | null;
  filter?: string | null;
  search?: string | null;
}

export function createListQuery(
  searchParams: RawQueryParams,
  previousFilterJson?: string | null,
): ListQuery {
  const pageSize = searchParams.pageSize ? Number(searchParams.pageSize) : 25;
  if (![25, 50, 100].includes(pageSize))
    throw new Error("VALIDATION pageSize must be 25, 50 or 100");

  const page = searchParams.page ? Number(searchParams.page) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new Error("VALIDATION page must be an integer >= 1");

  const sort: Record<string, 1 | -1> = { "DeviceID.ID": 1 };
  if (searchParams.sort) {
    if (searchParams.sort.length > FILTER_MAX_LENGTH)
      throw new Error("VALIDATION sort too long");
    const parsed = JSON.parse(searchParams.sort) as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== 1 && v !== -1)
        throw new Error("VALIDATION sort direction must be 1 or -1");
      sort[k] = v;
    }
    sort["DeviceID.ID"] ??= 1;
  }

  let filter: Expression | null = null;
  const filterRaw = searchParams.filter;
  if (filterRaw) {
    if (filterRaw.length > FILTER_MAX_LENGTH)
      throw new Error("VALIDATION filter too long");
    try {
      // Validate through the NATIVE parser: an invalid expression throws
      // instead of reaching the backend.
      filter = parse(filterRaw);
    } catch {
      throw new Error("VALIDATION invalid filter expression");
    }
  }
  if (searchParams.search)
    filter = ["AND", filter, buildSearchExpression(searchParams.search)].filter(
      (x): x is Expression => x !== null,
    ) as unknown as Expression;

  const nextFilterJson = filter ? stringify(filter) : null;
  // Filter changed => page resets to 1.
  const effectivePage =
    previousFilterJson !== undefined &&
    previousFilterJson !== nextFilterJson &&
    page !== 1
      ? 1
      : page;

  return {
    page: effectivePage,
    pageSize: pageSize as 25 | 50 | 100,
    filter,
    sort,
  };
}

// URL round-trip: the query serializes into safe search params.
export function toSearchParams(query: ListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  if (query.filter) params.set("filter", stringify(query.filter));
  const sortEntries = Object.entries(query.sort).filter(
    ([k]) => k !== "DeviceID.ID",
  );
  if (sortEntries.length)
    params.set("sort", JSON.stringify(Object.fromEntries(sortEntries)));
  return params;
}
