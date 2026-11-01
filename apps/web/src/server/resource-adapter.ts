// BFF resource adapter: normalizes browser list queries into bounded
// native limit/skip/sort/projection/filter parameters. All lengths are
// capped; the stable ID sort is appended so pagination never shuffles
// rows with duplicate sort values.

import {
  BFF_RESOURCES,
  PAGE_SIZES,
  QUERY_STRING_MAX,
  type BffResource,
  type PageSize,
} from "@contracts/resources.ts";

export interface ListQuery {
  page?: string;
  pageSize?: string;
  sort?: string;
  filter?: string;
  projection?: string;
}

export class AdapterError extends Error {
  code = "VALIDATION";

  constructor(message: string) {
    super(`VALIDATION ${message}`);
    this.name = "Error";
  }
}

export interface NormalizedList {
  skip: number;
  limit: number;
  page: number;
  pageSize: PageSize;
  sort: Record<string, 1 | -1>;
  filter: string | null;
  projection: string | null;
}

export function normalizeListQuery(
  query: ListQuery,
  resource: string,
): NormalizedList {
  const def = BFF_RESOURCES[resource as BffResource];
  if (!def) throw new AdapterError(`unknown resource ${resource}`);

  for (const value of [query.filter, query.sort, query.projection])
    if (value && value.length > QUERY_STRING_MAX)
      throw new AdapterError("query string exceeds 8192 chars");

  const pageSize = query.pageSize ? Number(query.pageSize) : 25;
  if (!PAGE_SIZES.includes(pageSize as PageSize))
    throw new AdapterError("pageSize must be 25, 50 or 100");

  const page = query.page ? Number(query.page) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new AdapterError("page must be an integer >= 1");

  const sort: Record<string, 1 | -1> = {};
  if (query.sort) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(query.sort);
    } catch {
      throw new AdapterError("sort must be valid JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new AdapterError("sort must be an object");
    const entries = Object.entries(parsed);
    if (entries.length > 8) throw new AdapterError("sort max 8 fields");
    for (const [k, v] of entries) {
      if (k.length > 256 || /[\r\n]/.test(k))
        throw new AdapterError("invalid sort field");
      if (v !== 1 && v !== -1) throw new AdapterError("sort direction 1/-1");
      sort[k] = v;
    }
  }
  // Stable tiebreaker on the resource's ID.
  sort[def.idSort] ??= 1;

  const projection = query.projection ?? null;
  if (projection && projection.split(",").length > 100)
    throw new AdapterError("projection max 100 fields");

  return {
    skip: (page - 1) * pageSize,
    limit: pageSize,
    page,
    pageSize: pageSize as PageSize,
    sort,
    filter: query.filter ?? null,
    projection,
  };
}

// Native upstream query string from a normalized list.
export function toNativeParams(n: NormalizedList): URLSearchParams {
  const params = new URLSearchParams();
  params.set("skip", String(n.skip));
  params.set("limit", String(n.limit));
  params.set("sort", JSON.stringify(n.sort));
  if (n.filter) params.set("filter", n.filter);
  if (n.projection) params.set("projection", n.projection);
  return params;
}
