import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineFetch } from "@/server/genieacs-client";

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));

vi.mock("@/server/genieacs-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/genieacs-client")>();
  return { ...actual, engineFetch: vi.fn() };
});

vi.mock("@/server/logger", () => ({
  getAppLogger: () => ({ emit: emitMock }),
}));

const engineFetchMock = vi.mocked(engineFetch);

import { POST as reportError } from "./route";

const ORIGIN = "http://localhost:3000";

function errorRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost:3000/api/app/client-errors", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "X-App-Request": "1",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function sessionUpstream(username: string | null): Response {
  if (username === null) return new Response("", { status: 401 });
  return new Response(JSON.stringify({ username }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  engineFetchMock.mockReset();
});

describe("POST /api/app/client-errors", () => {
  it("rejects anonymous and forged-cookie reports with 401", async () => {
    const anon = await reportError(errorRequest({ event: "e" }));
    expect(anon.status).toBe(401);

    engineFetchMock.mockResolvedValueOnce(sessionUpstream(null) as never);
    const forged = await reportError(
      errorRequest({ event: "e" }, { Cookie: "genieacs-ui-jwt=forged-token" }),
    );
    expect(forged.status).toBe(401);
  });

  it("enforces the same-origin mutation guard", async () => {
    const res = await reportError(
      new Request("http://localhost:3000/api/app/client-errors", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "X-App-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event: "e" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(engineFetchMock).not.toHaveBeenCalled();
  });

  it("rates per verified user, not a global bucket", async () => {
    engineFetchMock.mockImplementation(
      async () => sessionUpstream("alpha") as never,
    );
    for (let i = 0; i < 10; ++i) {
      const res = await reportError(
        errorRequest({ event: "e" }, { Cookie: "genieacs-ui-jwt=alpha-token" }),
      );
      expect(res.status).toBe(200);
    }
    const limited = await reportError(
      errorRequest({ event: "e" }, { Cookie: "genieacs-ui-jwt=alpha-token" }),
    );
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // User beta has their own quota.
    engineFetchMock.mockImplementation(
      async () => sessionUpstream("beta") as never,
    );
    const beta = await reportError(
      errorRequest({ event: "e" }, { Cookie: "genieacs-ui-jwt=beta-token" }),
    );
    expect(beta.status).toBe(200);
  });

  it("validates the event allowlist", async () => {
    engineFetchMock.mockResolvedValueOnce(sessionUpstream("gamma") as never);
    const res = await reportError(
      errorRequest(
        { event: "e", password: "leak" },
        { Cookie: "genieacs-ui-jwt=gamma-token" },
      ),
    );
    expect(res.status).toBe(400);
    expect(emitMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ password: expect.anything() }),
    );
  });
});
