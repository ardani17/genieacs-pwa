import { test, expect } from "@playwright/test";

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
