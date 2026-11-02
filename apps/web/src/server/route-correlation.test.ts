import { execFileSync } from "node:child_process";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { engineFetch } from "@/server/genieacs-client";

vi.mock("@/server/genieacs-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/genieacs-client")>();
  return { ...actual, engineFetch: vi.fn() };
});

const engineFetchMock = vi.mocked(engineFetch);

const UUID = "8f1c6d92-7d9e-4a4d-b3e2-222222222222";

beforeEach(() => {
  engineFetchMock.mockReset();
});

// The minted identity flows header == body == upstream on every route.
// Handlers re-derive the context from the proxy-set header, so a direct
// invocation with that header models the production hop exactly.
function withRequestId(
  headers: Record<string, string>,
): Record<string, string> {
  return { "x-request-id": UUID, ...headers };
}

describe("route correlation spot checks (RE-STD-09A)", () => {
  it("password: body, response header and engineFetch share the identity", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204 }) as never,
    );
    const { POST: changePassword } =
      await import("../app/api/app/password/route");
    const res = await changePassword(
      new Request("http://localhost:3000/api/app/password", {
        method: "POST",
        headers: withRequestId({
          Origin: "http://localhost:3000",
          "X-App-Request": "1",
          "Content-Type": "application/json",
          Cookie: "genieacs-ui-jwt=token",
        }),
        body: JSON.stringify({ oldPassword: "a", newPassword: "bbbbbbbb1!" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(UUID);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(UUID);
    expect(engineFetchMock.mock.calls[0][1]?.requestId).toBe(UUID);
  });

  it("vpn status: consistent identity on the data envelope", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ state: "unconfigured" }), {
        status: 200,
      }) as never,
    );
    const { GET: vpnStatus } = await import("../app/api/app/vpn/status/route");
    const res = await vpnStatus(
      new Request("http://localhost:3000/api/app/vpn/status", {
        headers: withRequestId({ Cookie: "genieacs-ui-jwt=token" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(UUID);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(UUID);
    expect(engineFetchMock.mock.calls[0][1]?.requestId).toBe(UUID);
  });

  it("resource item: upstream carries the identity", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ DeviceID: { ID: "x" } }), {
        status: 200,
      }) as never,
    );
    const mod = await import("../app/api/app/resources/[resource]/[id]/route");
    const res = await mod.GET(
      new Request("http://localhost:3000/api/app/resources/presets/abc", {
        headers: withRequestId({ Cookie: "genieacs-ui-jwt=token" }),
      }),
      { params: Promise.resolve({ resource: "presets", id: "abc" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(UUID);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(UUID);
    expect(engineFetchMock.mock.calls[0][1]?.requestId).toBe(UUID);
  });
});

describe("no constant audit ids remain in route files", () => {
  it('has no `requestId: "<literal>"` under apps/web/src/app/api/app', () => {
    // Guard for the sweep: the audit identity must always come from the
    // request context, never a per-route constant string.
    let grep: string;
    try {
      grep = execFileSync(
        "git",
        ["grep", "-l", 'requestId: "', "--", "apps/web/src/app/api/app"],
        { encoding: "utf8" },
      );
    } catch {
      return; // git grep exits 1 when nothing matches — that is the pass
    }
    throw new Error(`constant requestId literals found in:\n${grep}`);
  });
});
