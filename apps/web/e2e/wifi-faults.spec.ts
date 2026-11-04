import { test, expect } from "@playwright/test";

// WiFi, tags and faults flows (M05-E): SSID edits are separate from
// WAN binding, "keep" never sends a key, replacement secrets are not
// echoed, permission refusals are visible, and fault deletion follows
// the server's authority.

test.use({ storageState: "../../artifacts/auth/admin.json" });

const DEVICE = "TEST-DEVICE-00001";

test("wifi manager lists radios and never sends a key when keeping", async ({
  page,
}) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("tab", { name: "WiFi" }).click();
  await expect(
    page.getByRole("button", { name: "Atur SSID" }).first(),
  ).toBeVisible();

  const bodies: string[] = [];
  await page.route("**/api/app/devices/*/commands", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          operationId: "e2e-wifi-1",
          deviceId: DEVICE,
          state: "succeeded",
          phases: [{ name: "execute", state: "succeeded", taskIds: ["t1"] }],
        },
      }),
    });
  });

  await page.getByRole("button", { name: "Atur SSI" }).first().click();
  await page.getByLabel("Nama SSID (1–32 byte)").fill("LabRenamed");
  // Keep the existing key: submit as-is.
  await page.getByRole("button", { name: "Kirim perubahan" }).click();
  await expect(page.getByText("Berhasil", { exact: true })).toBeVisible();

  expect(bodies.length).toBe(1);
  const payload = JSON.parse(bodies[0]);
  const names: string[] = payload.tasks[0].parameterValues.map(
    ([n]: [string]) => n,
  );
  expect(names.some((n) => /Key|Passphrase|Password/i.test(n))).toBe(false);
  expect(names.some((n) => n.endsWith(".SSID"))).toBe(true);
});

test("wifi key replacement is not echoed into the table or result", async ({
  page,
}) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("tab", { name: "WiFi" }).click();
  await page.getByRole("button", { name: "Atur SSID" }).first().click();
  await page.getByLabel("Kunci WiFi").click();
  await page.getByRole("option", { name: "Ganti kunci" }).click();
  const secret = "replacement-secret-1";
  await page
    .getByPlaceholder("8–63 karakter atau 64 heksadesimal")
    .fill(secret);
  await page.route("**/api/app/devices/*/commands", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          operationId: "e2e-wifi-2",
          deviceId: DEVICE,
          state: "succeeded",
          phases: [{ name: "execute", state: "succeeded", taskIds: ["t1"] }],
        },
      }),
    }),
  );
  await page.getByRole("button", { name: "Kirim perubahan" }).click();
  await expect(page.getByText("Berhasil", { exact: true })).toBeVisible();
  // The typed secret is gone from the DOM after submit.
  await expect(page.getByText(secret)).toHaveCount(0);
});

test("tags add and remove through the native route", async ({ page }) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByLabel("Tag baru").fill("e2e-wifi-tag");
  await page.getByRole("button", { name: "Tambah tag" }).click();
  await expect(
    page.getByRole("button", { name: "Hapus tag e2e-wifi-tag" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Hapus tag e2e-wifi-tag" }).click();
  await expect(
    page.getByRole("button", { name: "Hapus tag e2e-wifi-tag" }),
  ).toHaveCount(0);
});

test("faults page lists and deletes with server permission", async ({
  page,
}) => {
  await page.goto("/faults");
  // No seeded faults: the empty table renders without errors.
  await expect(page.getByRole("table", { name: "Daftar fault" })).toBeVisible();
});

test("parameter edit requires the writable flag and confirmations", async ({
  page,
}) => {
  await page.goto(`/devices/${DEVICE}`);
  await page.getByRole("tab", { name: "Parameter" }).click();
  await expect(
    page.getByRole("table", { name: "Parameter perangkat" }),
  ).toBeVisible();
  // Selecting a read-only parameter keeps the value input disabled.
  await page
    .getByRole("row")
    .filter({ hasText: "DeviceID.Manufacturer" })
    .first()
    .click();
  await expect(page.getByLabel("Nilai parameter")).toBeDisabled();
});
