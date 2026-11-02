import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineFetch } from "@/server/genieacs-client";

vi.mock("@/server/genieacs-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/genieacs-client")>();
  return { ...actual, engineFetch: vi.fn() };
});

const engineFetchMock = vi.mocked(engineFetch);

import { GET, PUT, DELETE } from "./route";

const ORIGIN = "http://localhost:3000";
const COOKIE = "genieacs-ui-jwt=token";

function itemRequest(
  method: "GET" | "PUT" | "DELETE",
  resource = "devices",
  headers: Record<string, string> = {},
  body?: string,
): Request {
  return new Request(
    `http://localhost:3000/api/app/resources/${resource}/item-1`,
    {
      method,
      headers: { Cookie: COOKIE, ...headers },
      body,
    },
  );
}

function ctx(resource = "devices", id = "item-1") {
  return { params: Promise.resolve({ resource, id }) };
}

beforeEach(() => {
  engineFetchMock.mockReset();
});

describe("resource item mutation guard", () => {
  it("PUT/DELETE without origin or app header never reach the upstream", async () => {
    // PUT on a PUT-capable resource (presets); DELETE on devices.
    const put = await PUT(itemRequest("PUT", "presets"), ctx("presets"));
    expect(put.status).toBe(403);
    const del = await DELETE(itemRequest("DELETE", "devices"), ctx("devices"));
    expect(del.status).toBe(403);
    expect(engineFetchMock).not.toHaveBeenCalled();
  });

  it("PUT/DELETE with a wrong origin is rejected before upstream", async () => {
    for (const [method, resource, handler] of [
      ["PUT", "presets", PUT],
      ["DELETE", "devices", DELETE],
    ] as const) {
      const res = await handler(
        itemRequest(method, resource, {
          Origin: "https://evil.example",
          "X-App-Request": "1",
        }),
        ctx(resource),
      );
      expect(res.status).toBe(403);
    }
    expect(engineFetchMock).not.toHaveBeenCalled();
  });

  it("same-origin mutations proxy upstream", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204 }) as never,
    );
    const put = await PUT(
      itemRequest(
        "PUT",
        "presets",
        { Origin: ORIGIN, "X-App-Request": "1" },
        "{}",
      ),
      ctx("presets"),
    );
    expect(put.status).toBe(200);
    expect(engineFetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("generic device detail masking", () => {
  it("applies the same secret policy as the dedicated route", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          "DeviceID.ID": { value: ["dev-1", "xsd:string"] },
          "Device.WiFi.KeyPassphrase": { value: ["wpa-secret", "xsd:string"] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ) as never,
    );
    const res = await GET(
      itemRequest("GET", "devices"),
      ctx("devices", "dev-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("wpa-secret");
    expect(body.data["Device.WiFi.KeyPassphrase"].value).toBe("[REDACTED]");
  });
});
