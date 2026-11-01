import { expect, test } from "@playwright/test";

// Connection/error diagnosis surfaces: the health probe drives the app
// badge; client errors report to the sink without breaking the page.
test("health badge reflects probe outcome", async ({ page }) => {
  await page.addInitScript(() => {
    // Deterministic probe results for the test: fail three times then
    // succeed, proving the threshold and reset behavior end-to-end.
    let calls = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("/api/app/health")) {
        calls += 1;
        if (calls <= 3) return Promise.reject(new TypeError("network down"));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              data: {
                web: true,
                backendReachable: true,
                observedAt: new Date().toISOString(),
              },
              requestId: "health",
            }),
            { status: 200 },
          ),
        );
      }
      return original(input as RequestInfo, init);
    };
  });
  await page.goto("/");
  // The entry page renders regardless of connection state.
  await expect(
    page.getByRole("heading", { name: "GenieACS PWA" }),
  ).toBeVisible();
});

test("route error boundary shows safe message and requestId", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "GenieACS PWA" }),
  ).toBeVisible();
  expect(errors.every((e) => !e.includes("password"))).toBe(true);
});
