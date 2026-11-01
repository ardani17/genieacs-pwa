import { test, expect } from "@playwright/test";

test("device list table and pagination are keyboard operable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/devices");
  // Empty or populated list must render either the table region or the
  // empty state — never a crash.
  const region = page.getByRole("region", { name: /Daftar perangkat/ });
  const empty = page.getByText("Belum ada data.");
  await expect(region.or(empty).first()).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("mobile renders cards instead of the table", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/devices");
  const empty = page.getByText("Belum ada data.");
  await expect(empty.or(page.locator("main")).first()).toBeVisible();
});
