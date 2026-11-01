import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineFetch } from "@/server/genieacs-client";

vi.mock("@/server/genieacs-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/genieacs-client")>();
  return { ...actual, engineFetch: vi.fn() };
});

const engineFetchMock = vi.mocked(engineFetch);

import { POST as login } from "./route";

const ORIGIN = "http://localhost:3000";

function loginRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost:3000/api/app/login", {
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

function upstreamLoginFailure(): Response {
  return new Response("Incorrect username or password", { status: 400 });
}

beforeEach(() => {
  engineFetchMock.mockReset();
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("POST /api/app/login", () => {
  it("stores the native token under the native cookie name", async () => {
    engineFetchMock.mockResolvedValueOnce(
      new Response("token", {
        status: 200,
        headers: { "Set-Cookie": "genieacs-ui-jwt=native-jwt-value; Path=/" },
      }),
    );
    const res = await login(
      loginRequest({ username: "admin", password: "Fixture-Only-2026!" }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith("genieacs-ui-jwt=native-jwt-value")).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    // The token must NOT appear in the response body.
    expect(await res.text()).not.toContain("native-jwt-value");
  });

  it("rotating X-Forwarded-For cannot open new rate-limit buckets", async () => {
    engineFetchMock.mockImplementation(
      async () => upstreamLoginFailure() as never,
    );
    const username = "limit-xff-user";
    for (let i = 0; i < 10; ++i) {
      const res = await login(
        loginRequest(
          { username, password: "wrong" },
          { "X-Forwarded-For": `198.51.100.${i}` },
        ),
      );
      expect(res.status).toBe(401);
    }
    // 11th attempt with yet another spoofed address: still limited.
    const limited = await login(
      loginRequest(
        { username, password: "wrong" },
        { "X-Forwarded-For": "198.51.100.250" },
      ),
    );
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);

    // A different username on the same (untrusted) address is a
    // separate bucket: not limited yet.
    const other = await login(
      loginRequest({ username: "other-user", password: "wrong" }),
    );
    expect(other.status).toBe(401);
  });

  it("honors X-Forwarded-For behind one trusted proxy hop", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    engineFetchMock.mockImplementation(
      async () => upstreamLoginFailure() as never,
    );
    const username = "limit-trusted-user";
    // 10 failures as client 203.0.113.5 (last entry = client).
    for (let i = 0; i < 10; ++i) {
      const res = await login(
        loginRequest(
          { username, password: "wrong" },
          { "X-Forwarded-For": `198.51.100.7, 203.0.113.5` },
        ),
      );
      expect(res.status).toBe(401);
    }
    // Same client identity, different spoofed prefix: still limited.
    const limited = await login(
      loginRequest(
        { username, password: "wrong" },
        { "X-Forwarded-For": "198.51.100.99, 203.0.113.5" },
      ),
    );
    expect(limited.status).toBe(429);
    // A DIFFERENT real client is not punished by the first bucket.
    const otherClient = await login(
      loginRequest(
        { username, password: "wrong" },
        { "X-Forwarded-For": "198.51.100.7, 203.0.113.6" },
      ),
    );
    expect(otherClient.status).toBe(401);
  });
});
