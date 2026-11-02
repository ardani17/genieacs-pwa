import { afterEach, describe, expect, it } from "vitest";
import proxy from "./proxy";
import {
  PARENT_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
  TRUSTED_DIRECT_MARKER,
} from "./server/correlation";

const UUID = "9f1c6d92-7d9e-4a4d-b3e2-111111111111";

function call(headers: Record<string, string>): {
  requestId: string;
  parent: string | null;
  overridden: string[];
  marker: string | null;
  xff: string | null;
} {
  const request = new Request("http://localhost:3000/api/app/session", {
    headers,
  });
  const response = proxy(request as never);
  const overrideList =
    response.headers.get("x-middleware-override-headers") ?? "";
  const overridden = overrideList
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return {
    requestId: response.headers.get(REQUEST_ID_HEADER) ?? "",
    parent: response.headers.get(
      `x-middleware-request-${PARENT_REQUEST_ID_HEADER}`,
    ),
    overridden,
    marker: response.headers.get(
      `x-middleware-request-${TRUSTED_DIRECT_MARKER}`,
    ),
    xff: response.headers.get("x-middleware-request-x-forwarded-for"),
  };
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("proxy correlation (RE-STD-09A)", () => {
  it("ALWAYS mints a fresh server audit id — inbound ids are never inherited", () => {
    const a = call({ "x-request-id": UUID });
    const b = call({ "x-request-id": UUID });
    expect(a.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // Two requests presenting the SAME inbound UUID get DIFFERENT audit
    // identities…
    expect(a.requestId).not.toBe(b.requestId);
    // …but the (valid) inbound id is recorded as the PARENT for both.
    expect(a.parent).toBe(UUID);
    expect(b.parent).toBe(UUID);
  });

  it("drops invalid or missing inbound ids — no parent recorded", () => {
    expect(call({ "x-request-id": "../../etc" }).parent).toBeNull();
    expect(call({}).parent).toBeNull();
    // A client-forged parent header cannot survive: the proxy deletes it
    // before setting its own.
    const forged = call({
      "x-parent-request-id": "forged-parent",
      "x-request-id": UUID,
    });
    expect(forged.parent).toBe(UUID);
  });
});

describe("proxy client-address boundary (RE-STD-08)", () => {
  it("at hops=0 deletes client X-Forwarded-For and marks the request", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    const out = call({
      "X-Forwarded-For": "spoofed-a, spoofed-b",
      [TRUSTED_DIRECT_MARKER]: "1",
    });
    // The client chain is REMOVED from the overridden request headers —
    // Next re-injects the socket peer into the absence.
    expect(out.overridden).not.toContain("x-forwarded-for");
    expect(out.xff).toBeNull();
    // The marker is delete-then-set: the forged inbound value is
    // replaced by the proxy's own.
    expect(out.marker).toBe("1");
  });

  it("at hops>0 leaves the trusted edge XFF chain untouched", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    const out = call({
      "X-Forwarded-For": "spoofed, 10.0.0.1",
      [TRUSTED_DIRECT_MARKER]: "1",
    });
    expect(out.xff).toBe("spoofed, 10.0.0.1");
    // The marker never travels behind a trusted edge.
    expect(out.marker).toBeNull();
    expect(out.overridden).not.toContain(TRUSTED_DIRECT_MARKER);
  });
});
