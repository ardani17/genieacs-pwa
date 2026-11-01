// Resource names and the HTTP verbs the BFF maps to native endpoints.
// This is the single allowlist surface: an unmapped resource or verb is
// 404/405 at the BFF, never proxied.

export const BFF_RESOURCES = {
  devices: { verbs: ["GET", "DELETE"], idSort: "DeviceID.ID" },
  tasks: { verbs: ["GET"], idSort: "_id" },
  faults: { verbs: ["GET", "DELETE"], idSort: "_id" },
  files: { verbs: ["GET", "DELETE"], idSort: "_id" },
  presets: { verbs: ["GET", "PUT", "DELETE"], idSort: "_id" },
  provisions: { verbs: ["GET", "PUT", "DELETE"], idSort: "_id" },
  virtualParameters: {
    verbs: ["GET", "PUT", "DELETE"],
    idSort: "_id",
  },
  config: { verbs: ["GET", "PUT", "DELETE"], idSort: "_id" },
  permissions: { verbs: ["GET", "PUT", "DELETE"], idSort: "_id" },
  users: { verbs: ["GET", "PUT", "DELETE"], idSort: "_id" },
} as const;

export type BffResource = keyof typeof BFF_RESOURCES;
export type BffVerb = "GET" | "PUT" | "DELETE";

export function isBffResource(name: string): name is BffResource {
  return Object.hasOwn(BFF_RESOURCES, name);
}

export function verbAllowed(resource: BffResource, verb: string): boolean {
  return (BFF_RESOURCES[resource].verbs as readonly string[]).includes(verb);
}

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const CSV_ROW_CAP = 10000;
export const FILE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const QUERY_STRING_MAX = 8192;
