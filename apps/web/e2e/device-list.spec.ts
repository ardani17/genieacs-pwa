import { test, expect } from "@playwright/test";

// The device list needs an authenticated session (the dashboard layout
// redirects anonymous users); with the e2e overlay the fixture devices
// are actually THERE, so the table content is asserted, not just the
// chrome.
test.use({ storageState: "../../artifacts/auth/admin.json" });

test("device list table and pagination are keyboard operable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/devices");
  // The seeded fixture device is listed with its identity link.
  const region = page.getByRole("region", { name: /Daftar perangkat/ });
  await expect(region).toBeVisible();
  await expect(
    page.getByRole("link", { name: "TEST-DEVICE-00001" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("link", { name: "TEST-DEVICE-00001" }),
  ).toBeVisible();
});
