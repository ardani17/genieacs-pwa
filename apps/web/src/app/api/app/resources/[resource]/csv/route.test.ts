import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineFetch } from "@/server/genieacs-client";
import { DEVICES_CSV_COLUMNS } from "@contracts/resources.ts";

vi.mock("@/server/genieacs-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/genieacs-client")>();
  return { ...actual, engineFetch: vi.fn() };
});

const engineFetchMock = vi.mocked(engineFetch);

import { GET as exportCsv } from "./route";

const ORIGIN = "http://localhost:3000";

function csvRequest(resource: string, query = ""): Request {
  return new Request(
    `http://localhost:3000/api/app/resources/${resource}/csv${query}`,
    { headers: { Cookie: "genieacs-ui-jwt=token" } },
  );
}

function ctx(resource: string) {
  return { params: Promise.resolve({ resource }) };
}

beforeEach(() => {
  engineFetchMock.mockReset();
});

describe("resource CSV export", () => {
  it("is devices-only with the fixed column allowlist", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response("ID\ndev-1\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      }) as never,
    );
    const res = await exportCsv(csvRequest("devices"), ctx("devices"));
    expect(res.status).toBe(200);

    const [path, init] = engineFetchMock.mock.calls[0];
    expect(path).toContain("/api/devices.csv?");
    const sent = new URLSearchParams(path.split("?")[1]);
    // Client columns are IGNORED: only the contract allowlist travels.
    expect(JSON.parse(sent.get("columns") ?? "{}")).toEqual(
      DEVICES_CSV_COLUMNS,
    );
    void ORIGIN;
    void init;
  });

  it("rejects CSV for other resources without contacting the engine", async () => {
    const res = await exportCsv(csvRequest("users"), ctx("users"));
    expect(res.status).toBe(405);
    expect(engineFetchMock).not.toHaveBeenCalled();
  });

  it("exports with the SAME search+filter criteria as the list", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response("ID\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      }) as never,
    );
    await exportCsv(
      csvRequest(
        "devices",
        "?search=NO_MATCH&filter=_tags%20%3D%20%22online%22",
      ),
      ctx("devices"),
    );
    const [path] = engineFetchMock.mock.calls[0];
    const sent = new URLSearchParams(path.split("?")[1]);
    const filter = sent.get("filter") ?? "";
    expect(filter).toContain('_tags = "online"');
    // The needle's underscore is ESCAPED as a literal (RE-SPEC-07): the
    // LIKE clauses carry NO\\_MATCH (one backslash in the pattern, two
    // in the serialized text) with an explicit ESCAPE character.
    expect(filter).toContain("NO\\\\_MATCH");
    expect(filter).toContain('ESCAPE "\\\\"');
    expect(filter).toContain("AND");
  });
});
