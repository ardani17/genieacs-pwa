import test from "node:test";
import assert from "node:assert/strict";
import Koa from "koa";
import http from "node:http";
import { sendSafeLegacyError } from "../../lib/ui/safe-error.ts";

// Legacy error responses must be text/plain + nosniff with an allowlisted
// body — never a Koa auto-inferred text/html page that a browser would
// render. The <img onerror> payload below is an INERT fixture asserting
// exactly that.

function boot(fn: (ctx: Koa.Context) => void): Promise<{
  server: http.Server;
  url: string;
}> {
  const app = new Koa();
  app.use((ctx) => fn(ctx));
  const server = app.listen(0, "127.0.0.1");
  return new Promise((resolve) =>
    server.once("listening", () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
      }),
    ),
  );
}

void test("safe error bodies are text/plain, nosniff, no raw error text", async () => {
  const inert = '<img src=x onerror="window.__xss=1">';
  const { server, url } = await boot((ctx) => {
    try {
      throw new Error(inert);
    } catch (err) {
      // Raw error only reaches the logger; the wire gets a fixed message.
      sendSafeLegacyError(
        ctx,
        400,
        "put_failed",
        "The resource could not be updated.",
      );
      void err;
    }
  });
  try {
    const res = await fetch(url);
    assert.equal(res.status, 400);
    assert.match(
      res.headers.get("content-type") ?? "",
      /^text\/plain; charset=utf-8/,
    );
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    const body = await res.text();
    assert.ok(!body.includes("<img"));
    assert.match(body, /Error: put_failed \(request [0-9a-f-]+\)/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

void test("a plain string body without the helper would infer HTML", async () => {
  // Control case proving the helper is what prevents HTML inference.
  const { server, url } = await boot((ctx) => {
    ctx.status = 400;
    ctx.body = '<img src=x onerror="window.__xss=1">';
  });
  try {
    const res = await fetch(url);
    assert.match(
      res.headers.get("content-type") ?? "",
      /html/,
      "control: koa infers HTML for bare strings",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
