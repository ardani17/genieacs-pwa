import { describe, expect, it } from "vitest";
import {
  APP_COOKIE_NAME,
  clientIpForRateLimit,
  nativeCookieFrom,
} from "./genieacs-client";

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/app/login", {
    method: "POST",
    headers,
  });
}

describe("clientIpForRateLimit", () => {
  it("discards client-supplied X-Forwarded-For by default (0 hops)", () => {
    delete process.env.TRUSTED_PROXY_HOPS;
    const ip = clientIpForRateLimit(
      requestWith({ "X-Forwarded-For": "1.2.3.4, 5.6.7.8" }),
    );
    expect(ip).toBe("direct");
  });

  it("uses the entry N trusted hops from the right", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    try {
      // Caddy appends the real peer: the LAST entry is the client.
      const ip = clientIpForRateLimit(
        requestWith({ "X-Forwarded-For": "9.9.9.9, 10.0.0.1" }),
      );
      expect(ip).toBe("10.0.0.1");
      // A single entry behind one proxy IS the appended client.
      expect(
        clientIpForRateLimit(requestWith({ "X-Forwarded-For": "9.9.9.9" })),
      ).toBe("9.9.9.9");
      // Fewer entries than configured hops: nothing trustworthy remains.
      process.env.TRUSTED_PROXY_HOPS = "2";
      expect(
        clientIpForRateLimit(requestWith({ "X-Forwarded-For": "9.9.9.9" })),
      ).toBe("direct");
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  it("ignores invalid hop configuration", () => {
    process.env.TRUSTED_PROXY_HOPS = "many";
    try {
      expect(
        clientIpForRateLimit(requestWith({ "X-Forwarded-For": "1.2.3.4" })),
      ).toBe("direct");
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });
});

describe("cookie contract", () => {
  it("uses the native cookie name end to end", () => {
    expect(APP_COOKIE_NAME).toBe("genieacs-ui-jwt");
  });

  it("reads the session token only under the contract name", () => {
    expect(nativeCookieFrom("other=tok; genieacs-ui-jwt=abc; x=1")).toBe("abc");
    expect(nativeCookieFrom("app-session=abc")).toBeNull();
    expect(nativeCookieFrom(null)).toBeNull();
  });
});
