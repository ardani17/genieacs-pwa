import { beforeEach, expect, test, vi } from "vitest";
import { engineFetch } from "./genieacs-client";
import { vpnAction } from "./vpn-routes";
vi.mock("./genieacs-client", async (original) => ({
  ...(await original<typeof import("./genieacs-client")>()),
  engineFetch: vi.fn(),
}));
const engine = vi.mocked(engineFetch);
const headers = {
  Origin: "http://localhost:3000",
  "X-App-Request": "1",
  Cookie: "genieacs-ui-jwt=fixture",
  "Content-Type": "application/json",
};
const request = (body: unknown, overrides: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/app/vpn/diagnose", {
    method: "POST",
    headers: { ...headers, ...overrides },
    body: JSON.stringify(body),
  });
beforeEach(() => engine.mockReset());
test("reject cross-origin, bearer-only sessions, arbitrary targets and coerced reset DTOs before upstream", async () => {
  expect(
    (
      await vpnAction(
        request({}, { Origin: "https://elsewhere.invalid" }),
        "diagnose",
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await vpnAction(
        request({}, { Cookie: "", Authorization: "Bearer fixture" }),
        "diagnose",
      )
    ).status,
  ).toBe(401);
  expect(
    (await vpnAction(request({ host: "127.0.0.1" }), "diagnose")).status,
  ).toBe(400);
  expect(
    (
      await vpnAction(
        request({ revision: 2, confirm: ["RESET"] }),
        "reset-bootstrap",
      )
    ).status,
  ).toBe(400);
  expect(engine).not.toHaveBeenCalled();
});
test("forwards only the native session to fixed routes and preserves conflict plus no-store", async () => {
  engine.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: "CONFLICT", message: "busy", retryable: false },
      }),
      { status: 409 },
    ),
  );
  const response = await vpnAction(request({}), "reconnect");
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await response.json()).error.code).toBe("CONFLICT");
  expect(engine.mock.calls[0][0]).toBe("/api/app/vpn/reconnect");
  expect(engine.mock.calls[0][1]?.cookie).toBe("fixture");
  expect(engine.mock.calls[0][1]?.headers).toBeUndefined();
});
