import { test, expect, type Page } from "@playwright/test";
const admin = "../../artifacts/auth/admin.json";
const operator = "../../artifacts/auth/operator.json";
const headers = {
  Origin: process.env.PW_BASE_URL ?? "http://localhost:3000",
  "X-App-Request": "1",
};
async function saveProfile(page: Page, server: string) {
  const response = await page.request.get("/api/app/settings");
  expect(response.status()).toBe(200);
  const status = (await response.json()).data;
  const view = status.view;
  const result = await page.request.put("/api/app/settings", {
    headers,
    data: {
      revision: view?.revision ?? 0,
      server,
      username: "fixture-vpn-user",
      passwordAction: "replace",
      password: "vpn-password-for-isolated-tests-only",
      routes: ["10.77.0.0/16"],
      mtu: 1400,
      acs: {
        mode: "auto-ppp",
        scheme: "http",
        host: null,
        port: 7547,
        path: "/",
      },
    },
  });
  expect(result.status()).toBe(200);
  return (await result.json()).data;
}
test.describe("M07 admin", () => {
  test.use({ storageState: admin });
  test.beforeEach(async ({ page }) => {
    await saveProfile(page, "vpn-initial.example.invalid");
  });
  test("failed profile persists while dashboard stays usable", async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/settings/vpn");
    await page
      .getByLabel("Server VPN", { exact: true })
      .fill("vpn-fail.example.invalid");
    await page
      .getByRole("button", { name: "Simpan profil", exact: true })
      .click();
    await expect(page.getByText(/Profil tersimpan\./)).toBeVisible();
    await expect
      .poll(async () => {
        const result = await page.request.get("/api/app/vpn/status");
        return (await result.json()).data.state;
      })
      .toBe("retry_wait");
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      page.getByText(/Profil tersimpan; koneksi gagal/),
    ).toBeVisible();
    await expect(page.getByLabel("Server VPN", { exact: true })).toHaveValue(
      "vpn-fail.example.invalid",
    );
    await page.screenshot({
      path: `../../artifacts/m07-vpn-${info.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Perangkat", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/devices/);
    expect(errors).toEqual([]);
  });
  test("CAS preserves local edits, comparison and reload are explicit", async ({
    page,
  }) => {
    await page.goto("/settings/vpn");
    await page
      .getByLabel("Server VPN", { exact: true })
      .fill("local.example.invalid");
    await saveProfile(page, "other.example.invalid");
    await page
      .getByRole("button", { name: "Simpan profil", exact: true })
      .click();
    await expect(page.getByText(/Form lokal dipertahankan/)).toBeVisible();
    await expect(page.getByLabel("Server VPN", { exact: true })).toHaveValue(
      "local.example.invalid",
    );
    await page
      .getByRole("button", { name: "Bandingkan dengan server" })
      .click();
    await expect(
      page.locator("pre").filter({ hasText: "other.example.invalid" }),
    ).toBeVisible();
    await expect(page.getByLabel("Server VPN", { exact: true })).toHaveValue(
      "local.example.invalid",
    );
    await page.getByRole("button", { name: "Muat ulang profil" }).click();
    await expect(page.getByLabel("Server VPN", { exact: true })).toHaveValue(
      "other.example.invalid",
    );
  });
  test("auth rejection pauses until a manual reconnect or corrected revision", async ({
    page,
  }) => {
    await saveProfile(page, "vpn-auth.example.invalid");
    await expect
      .poll(async () => {
        const result = await page.request.get("/api/app/vpn/status");
        const body = await result.json();
        return [body.data.state, body.data.nextAttemptAt];
      })
      .toEqual(["auth_failed", null]);
    await page.goto("/settings/vpn");
    await expect(
      page.getByText("Autentikasi ditolak — retry dijeda", { exact: true }),
    ).toBeVisible();
    const reconnect = await page.request.post("/api/app/vpn/reconnect", {
      headers,
      data: {},
    });
    expect(reconnect.status()).toBe(200);
    await saveProfile(page, "vpn-corrected.example.invalid");
    await expect
      .poll(async () => {
        const result = await page.request.get("/api/app/vpn/status");
        return (await result.json()).data.state;
      })
      .toBe("connected");
  });
  test("reset validates literal confirmation and stale revisions", async ({
    page,
  }) => {
    const saved = await saveProfile(page, "vpn-custom.example.invalid");
    const wrong = await page.request.post("/api/app/vpn/reset-bootstrap", {
      headers,
      data: { revision: saved.desiredRevision, confirm: ["RESET"] },
    });
    expect(wrong.status()).toBe(400);
    const stale = await page.request.post("/api/app/vpn/reset-bootstrap", {
      headers,
      data: { revision: saved.desiredRevision - 1, confirm: "RESET" },
    });
    expect(stale.status()).toBe(409);
    const reset = await page.request.post("/api/app/vpn/reset-bootstrap", {
      headers,
      data: { revision: saved.desiredRevision, confirm: "RESET" },
    });
    expect(reset.status()).toBe(200);
    expect((await reset.json()).data.view.server).toBe(
      "vpn-initial.example.invalid",
    );
  });
  test("log search/export is bounded and requestId drilldown stays internal", async ({
    page,
  }, info) => {
    await page.goto("/diagnostics/logs");
    await page.getByLabel("Layanan", { exact: true }).fill("ui");
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/app/logs") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Cari log", exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Ekspor log (maks. 10.000)" }),
    ).toBeEnabled();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Ekspor log (maks. 10.000)" })
      .click();
    expect((await download).suggestedFilename()).toBe("genieacs-logs.ndjson");
    const tooLarge = await page.request.post("/api/app/logs/export", {
      headers,
      data: { limit: 10001 },
    });
    expect(tooLarge.status()).toBe(400);
    const injection = await page.request.post("/api/app/logs", {
      headers,
      data: { query: "* | delete" },
    });
    expect(injection.status()).toBe(400);
    await page.goto("/diagnostics/logs?requestId=fixture-request-id");
    await expect(page.getByLabel("Request ID", { exact: true })).toHaveValue(
      "fixture-request-id",
    );
    await page.screenshot({
      path: `../../artifacts/m07-logs-${info.project.name}.png`,
      fullPage: true,
    });
  });
  test("log outage message permits retry and VPN correction", async ({
    page,
  }) => {
    await page.route("**/api/app/logs", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { message: "Log store unavailable" },
          requestId: "fixture-outage",
        }),
      }),
    );
    await page.goto("/diagnostics/logs");
    await page.getByRole("button", { name: "Cari log", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Logging degraded" }),
    ).toContainText("Logging degraded");
    await expect(
      page.getByRole("button", { name: "Coba lagi", exact: true }),
    ).toBeEnabled();
    await page.goto("/settings/vpn");
    await expect(page.getByLabel("Server VPN", { exact: true })).toBeEditable();
  });
});
test.describe("M07 operator", () => {
  test.use({ storageState: operator });
  test("can view status/diagnose; settings, reconnect, reset and logs are denied", async ({
    page,
  }) => {
    await page.goto("/settings/vpn");
    await expect(
      page.getByRole("heading", { name: "Status VPN", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Server VPN", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Hubungkan ulang" }),
    ).toHaveCount(0);
    expect((await page.request.get("/api/app/settings")).status()).toBe(403);
    for (const path of ["reconnect", "reset-bootstrap"])
      expect(
        (
          await page.request.post(`/api/app/vpn/${path}`, {
            headers,
            data:
              path === "reset-bootstrap"
                ? { revision: 1, confirm: "RESET" }
                : {},
          })
        ).status(),
      ).toBe(403);
    expect(
      (
        await page.request.post("/api/app/vpn/diagnose", { headers, data: {} })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post("/api/app/vpn/diagnose", {
          headers,
          data: { host: "127.0.0.1" },
        })
      ).status(),
    ).toBe(400);
    await page.goto("/diagnostics/logs");
    await expect(
      page.getByText("Tidak ada izin membaca log global."),
    ).toBeVisible();
  });
});
