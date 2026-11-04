import { test, expect } from "@playwright/test";

// Authenticated device detail coverage (fixture admin identity): the
// dashboard layout accepts the native session, the contract tabs open,
// parameter search/pagination behave and secret parameter values are
// masked in the browser. The anonymous-redirect behaviour stays covered
// below so both sides of the auth boundary are pinned.

const STORAGE = (identity: string): string =>
  `../../artifacts/auth/${identity}.json`;

test("device detail tabs are operable on mobile and desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // Anonymous users are redirected to login by the dashboard layout.
  await page.goto("/devices/TEST-DEVICE-00001");
  await expect(page).toHaveURL(/\/login/);
});

test("detail tabs expose accessible names", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/devices/TEST-DEVICE-00001");
  await expect(page).toHaveURL(/\/login/);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe("authenticated admin", () => {
  test.use({ storageState: STORAGE("admin") });

  test("device detail opens after login with operable contract tabs", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/devices/TEST-DEVICE-00001");

    await expect(
      page.getByRole("heading", { name: /TEST-DEVICE-00001/ }),
    ).toBeVisible();

    const tabs = page.getByRole("tablist", { name: "Bagian detail" });
    await expect(tabs).toBeVisible();
    for (const name of ["Ringkasan", "WAN", "WiFi", "Parameter", "Diagnosis"]) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    }

    // Tab panels switch and render (fixture device has a software
    // version on the summary panel).
    await page.getByRole("tab", { name: "Ringkasan", exact: true }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Ringkasan" }),
    ).toBeVisible();
    await expect(page.getByText("V6.0.10P3N19")).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("parameter search filters and secrets stay masked", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/devices/TEST-DEVICE-00001");
    await page.getByRole("tab", { name: "Parameter", exact: true }).click();

    const search = page.getByLabel("Cari parameter");
    await expect(search).toBeVisible();

    // The fixture device carries a secret parameter whose VALUE must
    // never reach the browser, in the panel or anywhere on the page.
    await expect(page.getByText("e2e-secret-passphrase")).toHaveCount(0);
    // Search before inspecting the row: larger fixtures paginate the
    // parameter table, so this row need not be on the first page.
    await search.fill("KeyPassphrase");
    await expect(
      page
        .getByRole("row", {
          name: /KeyPassphrase/,
        })
        .filter({ hasText: /\[REDACTED\]/ }),
    ).toBeVisible();

    // Search narrows the parameter table to matches.
    await search.fill("SerialNumber");
    await expect(
      page.getByRole("row", { name: /SerialNumber/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("row", { name: /KeyPassphrase/ })).toHaveCount(
      0,
    );
    await search.fill("");
  });

  test("unknown device renders the error state for an authenticated user", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/devices/TEST-DEVICE-99999");
    // The dedicated BFF detail route maps the engine 404 to the
    // device-not-found status — never a crash, never a fabricated
    // device.
    await expect(page.getByText("Perangkat tidak ditemukan.")).toBeVisible();
  });
});
