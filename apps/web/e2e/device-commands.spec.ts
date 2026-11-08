import { test, expect } from "@playwright/test";

// Device command flows (M05-D): destructive actions need the literal
// device id, unknown results NEVER render as success, operators get a
// visible permission error, staging reviews before commit and the WAN
// editor takes its modes from the device capability with the blank
// password staying blank in the payload.

test.use({ storageState: "../../artifacts/auth/admin.json" });

const DEVICE = "TEST-DEVICE-00001";

test("unknown command result never shows success toast", async ({ page }) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("button", { name: "Reboot", exact: true }).click();
  await page.getByLabel("Konfirmasi ID perangkat").fill(DEVICE);
  // The browser connection drops mid-submit: no HTTP status at all.
  await page.route("**/commands", (r) => r.abort("failed"));
  await page.getByRole("button", { name: "Jalankan", exact: true }).click();
  await expect(
    page.getByText("Hasil belum terkonfirmasi", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Berhasil", { exact: true })).toHaveCount(0);
});

test("wrong confirmation id blocks the destructive action", async ({
  page,
}) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("button", { name: "Reboot", exact: true }).click();
  const run = page.getByRole("button", { name: "Jalankan", exact: true });
  await expect(run).toBeDisabled();
  await page.getByLabel("Konfirmasi ID perangkat").fill("WRONG-ID");
  await expect(run).toBeDisabled();
  await page.getByLabel("Konfirmasi ID perangkat").fill(DEVICE);
  await expect(run).toBeEnabled();
});

test("staged tasks are reviewed then committed once", async ({ page }) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("button", { name: "Reboot", exact: true }).click();
  await page.getByRole("button", { name: "Tahankan", exact: true }).click();
  // Client-side navigation keeps the in-memory staging store alive
  // (hard reloads drop staged work by design).
  await page.getByRole("link", { name: "Task" }).first().click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Reboot" }),
  ).toBeVisible();

  let submissions = 0;
  await page.route("**/api/app/devices/*/commands", async (route) => {
    submissions++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          operationId: "e2e-op-1",
          deviceId: DEVICE,
          state: "succeeded",
          phases: [{ name: "execute", state: "succeeded", taskIds: ["t1"] }],
        },
      }),
    });
  });
  await page.getByRole("button", { name: /Kirim \d task/ }).click();
  await expect(page.getByText("Berhasil", { exact: true })).toBeVisible();
  await expect(page.getByText("Eksekusi")).toBeVisible();
  // Exactly one submission — no automatic retry.
  expect(submissions).toBe(1);
});

test("a broken commit response keeps the operation id for recovery", async ({
  page,
}) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("button", { name: "Reboot", exact: true }).click();
  await page.getByRole("button", { name: "Tahankan", exact: true }).click();
  await page.getByRole("link", { name: "Task" }).first().click();
  // The gateway dies mid-commit: an unparseable 502 body (PR #8 review
  // — the operation id used to be lost with the response).
  await page.route("**/api/app/devices/*/commands", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html>gateway</html>",
    });
  });
  await page.getByRole("button", { name: /Kirim \d task/ }).click();
  await expect(
    page.getByText("Hasil belum terkonfirmasi", { exact: false }).first(),
  ).toBeVisible();
  const recovery = page.getByRole("link", {
    name: "Lihat hasil operasi berdasarkan ID",
  });
  await expect(recovery).toBeVisible();
  // The link opens the id-based lookup — never a resubmission.
  await page.unroute("**/api/app/devices/*/commands");
  await recovery.click();
  await expect(
    page.getByRole("heading", { name: "Hasil operasi", exact: true }),
  ).toBeVisible();
});

test("operator without devices:3 sees the server refusal, not success", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: "../../artifacts/auth/operator.json",
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("button", { name: "Reboot", exact: true }).click();
  await page.getByLabel("Konfirmasi ID perangkat").fill(DEVICE);
  await page.getByRole("button", { name: "Jalankan", exact: true }).click();
  await expect(
    page.getByText("Anda tidak memiliki izin untuk aksi ini."),
  ).toBeVisible();
  await expect(page.getByText("Berhasil", { exact: true })).toHaveCount(0);
  await context.close();
});

test("wan editor takes modes from capability and keeps passwords blank", async ({
  page,
}) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("tab", { name: "WAN" }).click();
  // F670 P3N19: the verified correction replaces PPPoE_Bridged with
  // IP_Bridged on WAN IP — options live in the open radix popup.
  await page.getByLabel("Conn Mode").click();
  const modeValues = await page.getByRole("option").allTextContents();
  expect(modeValues.join(" ")).toContain("IP_Bridged");
  expect(modeValues.join(" ")).not.toContain("PPPoE_Bridged");

  const bodies: string[] = [];
  await page.route("**/api/app/devices/*/wan", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          operationId: "e2e-wan-1",
          deviceId: DEVICE,
          state: "partial",
          phases: [
            { name: "write", state: "succeeded", taskIds: ["t1"] },
            { name: "refresh", state: "failed", taskIds: ["t2"] },
          ],
          warnings: ["Refresh gagal; binding tidak dijalankan."],
        },
      }),
    });
  });
  // Bridge requires a binding: pick the Lab SSID, then submit.
  await page.getByRole("option", { name: "IP_Bridged" }).click();
  await page.getByLabel(/LAN bind/).click();
  await page.getByRole("option", { name: /Lab/ }).click();
  await page.getByRole("button", { name: "Terapkan", exact: true }).click();
  await expect(page.getByText("Sebagian berhasil")).toBeVisible();
  await expect(page.getByText("Refresh", { exact: true })).toBeVisible();
  // The submitted settings carried a blank password (keep), and the
  // partial phases are visible — never a plain success.
  expect(bodies.length).toBe(1);
  expect(JSON.parse(bodies[0]).settings.password).toBe("");
});

test("unverified firmware keeps the wan editor read-only", async ({ page }) => {
  await page.goto("/devices/TEST-DEVICE-00002");
  await page.getByRole("tab", { name: "WAN" }).click();
  await expect(
    page.getByText(/belum terverifikasi untuk perubahan WAN/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Terapkan", exact: true }),
  ).toHaveCount(0);
});
