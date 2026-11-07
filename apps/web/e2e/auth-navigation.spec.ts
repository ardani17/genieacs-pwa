import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Unexpected console errors fail the suite.
  page.on("pageerror", (err) => {
    throw new Error(`Unexpected page error: ${err.message}`);
  });
});

test("operator mobile navigation omits global log and keeps status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill("operator");
  // The Field component marks required labels with " *".
  await page.getByLabel(/^Password/).fill("Fixture-Only-2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Navigasi utama" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Log global", exact: true }),
  ).toHaveCount(0);
});

test("login rejects wrong credentials with a generic error", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill("operator");
  await page.getByLabel(/^Password/).fill("wrong-password");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(/salah|percobaan/);
  await expect(page).toHaveURL(/\/login/);
});
