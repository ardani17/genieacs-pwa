import { expect, test } from "@playwright/test";

test.use({ storageState: "../../artifacts/auth/admin.json" });

test("forms and mobile menu remain accessible at the configured viewport", async ({
  page,
}, info) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Masuk", exact: true }),
  ).toBeVisible();
  expect(
    (await page.getByLabel("Nama pengguna").boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  await page.goto("/account/password");
  await expect(page.getByLabel("Password saat ini")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("account.png"),
    fullPage: true,
  });
  await page.goto("/devices");
  if ((page.viewportSize()?.width ?? 0) < 768) {
    const more = page.getByRole("button", { name: "Lainnya" });
    await more.click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
    await expect(more).toBeFocused();
  }
});

test("shared shell and controls fit the configured viewport", async ({
  page,
}, info) => {
  await page.goto("/devices");
  await expect(
    page.getByRole("heading", { name: "Perangkat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "TEST-DEVICE-00001", exact: true }),
  ).toBeVisible();
  const input = page.getByLabel("Cari perangkat", { exact: true });
  expect((await input.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(
    (await page.getByRole("button", { name: "Ekspor CSV" }).boundingBox())
      ?.height,
  ).toBeGreaterThanOrEqual(44);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: info.outputPath("devices.png"),
    fullPage: true,
  });
  await page.goto("/overview");
  await expect(
    page.getByText("Total perangkat", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Sumber: live", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: info.outputPath("overview.png"),
    fullPage: true,
  });
});

test("native filter, count, CSV, sort and page size preserve one query", async ({
  page,
}) => {
  const query = new URLSearchParams({
    filter: 'DeviceID.SerialNumber = "TEST-SN-1"',
  });
  await page.goto(`/devices?${query}`);
  await expect(
    page.getByRole("link", { name: "TEST-DEVICE-00001", exact: true }),
  ).toBeVisible();
  const size = page.getByRole("combobox", { name: "Ukuran halaman" });
  await size.focus();
  await page.keyboard.press("Space");
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(page).toHaveURL(/pageSize=50/);
  await page.getByRole("combobox", { name: "Urutkan perangkat" }).click();
  await page.getByRole("option", { name: "ID: Z–A" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sort"))
    .toBe('{"DeviceID.ID":-1}');
  expect(new URL(page.url()).searchParams.get("filter")).toBe(
    query.get("filter"),
  );
  const list = await page.request.get(`/api/app/resources/devices?${query}`);
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.data.total).toBe(1);
  expect(body.data.items).toHaveLength(1);
  const count = await page.request.head(`/api/app/resources/devices?${query}`);
  expect(count.headers()["x-total-count"]).toBe("1");
  const csv = await page.request.get(`/api/app/resources/devices/csv?${query}`);
  expect(csv.status()).toBe(200);
  const text = await csv.text();
  expect(text).toContain("TEST-DEVICE-00001");
  expect(text).not.toContain("TEST-DEVICE-00002");
  expect(text).not.toContain("e2e-secret-passphrase");
});

test("literal tag search survives reload and detail tabs support arrows", async ({
  page,
}) => {
  await page.goto("/devices");
  await page.getByLabel("Cari perangkat", { exact: true }).fill("fixture-a\\b");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("search"))
    .toBe("fixture-a\\b");
  await expect(
    page.getByRole("link", { name: "TEST-DEVICE-00001", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Cari perangkat", { exact: true })).toHaveValue(
    "fixture-a\\b",
  );
  await page.goto("/devices/TEST-DEVICE-00001");
  const summary = page.getByRole("tab", { name: "Ringkasan", exact: true });
  await expect(summary).toBeVisible();
  await summary.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "WAN", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "WAN", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Parameter", exact: true }).click();
  await page.getByLabel("Cari parameter").fill("KeyPassphrase");
  await expect(page.getByText("[REDACTED]", { exact: true })).toBeVisible();
  await expect(page.getByText("e2e-secret-passphrase")).toHaveCount(0);
  await page.getByRole("tab", { name: "Diagnosis", exact: true }).click();
  await page.getByRole("button", { name: "Jalankan diagnosis" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Tidak tersedia" }).first(),
  ).toBeVisible();
});
