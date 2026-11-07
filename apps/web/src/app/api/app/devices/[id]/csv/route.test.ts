import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineFetch } from "@/server/genieacs-client";

vi.mock("@/server/genieacs-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/genieacs-client")>();
  return { ...actual, engineFetch: vi.fn() };
});

const engineFetchMock = vi.mocked(engineFetch);

import { GET as deviceCsv } from "./route";

// Engine dialect: only the Value column is quoted and a secret value
// may span physical lines inside those quotes (RE-STD-04 repro shape).
const MULTILINE_CSV = [
  "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
  'Device.WiFi.KeyPassphrase,0,1,1,1,"line1\nROUTE_MULTILINE_SECRET","xsd:string",1,0,0,0,1',
  'Device.Wan.IP,0,1,1,1,"10.0.0.1, backup","xsd:string",1,0,0,0,1',
].join("\n");

function csvRequest(id: string): Request {
  return new Request(
    `http://localhost:3000/api/app/devices/${encodeURIComponent(id)}/csv`,
    { headers: { Cookie: "genieacs-ui-jwt=token" } },
  );
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  engineFetchMock.mockReset();
});

describe("per-device parameter CSV", () => {
  it("masks a multiline quoted secret before the bytes reach the browser", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response(MULTILINE_CSV, {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      }) as never,
    );
    const res = await deviceCsv(
      csvRequest("TEST-DEVICE-0001"),
      ctx("TEST-DEVICE-0001"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="device-TEST-DEVICE-0001.csv"',
    );

    const body = await res.text();
    // The whole secret VALUE is gone — including its continuation line,
    // not just the first physical line of it.
    expect(body).not.toContain("ROUTE_MULTILINE_SECRET");
    expect(body).not.toContain("line1");
    expect(body).toContain('"[REDACTED]"');
    // Non-secret rows survive byte-identical, comma-in-quotes included.
    expect(body).toContain('"10.0.0.1, backup"');

    const [path, init] = engineFetchMock.mock.calls[0];
    expect(path).toBe("/api/devices/TEST-DEVICE-0001.csv");
    expect(init?.cookie).toBe("token");
  });

  it("encodes the id exactly once and sanitizes the filename", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response("Parameter\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      }) as never,
    );
    const res = await deviceCsv(csvRequest("a/b c%"), ctx("a/b c%"));
    expect(res.status).toBe(200);
    const [path] = engineFetchMock.mock.calls[0];
    expect(path).toBe(`/api/devices/${encodeURIComponent("a/b c%")}.csv`);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="device-a_b_c_.csv"',
    );
  });

  it("maps upstream statuses to safe envelopes without leaking bodies", async () => {
    for (const [upstream, expected, code] of [
      [404, 404, "NOT_FOUND"],
      [403, 403, "FORBIDDEN"],
      [500, 503, "BACKEND_UNAVAILABLE"],
    ] as const) {
      engineFetchMock.mockResolvedValueOnce(
        new Response("upstream noise", { status: upstream }) as never,
      );
      const res = await deviceCsv(csvRequest("dev-1"), ctx("dev-1"));
      expect(res.status).toBe(expected);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe(code);
    }
  });

  it("returns 401 without a cookie and never contacts the engine", async () => {
    const res = await deviceCsv(
      new Request("http://localhost:3000/api/app/devices/dev-1/csv"),
      ctx("dev-1"),
    );
    expect(res.status).toBe(401);
    expect(engineFetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the engine is unreachable", async () => {
    engineFetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const res = await deviceCsv(csvRequest("dev-1"), ctx("dev-1"));
    expect(res.status).toBe(503);
  });
});
