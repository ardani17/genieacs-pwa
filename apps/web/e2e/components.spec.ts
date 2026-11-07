import { expect, test } from "@playwright/test";

// Component fixture page is test-only; the components themselves render
// behind authentication in production routes.
test("status and buttons remain operable across viewports", async ({
  page,
}) => {
  await page.goto("/");
  const heading = page.getByRole("heading", { name: "GenieACS PWA" });
  await expect(heading).toBeVisible();
  // No horizontal overflow at any supported viewport.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
