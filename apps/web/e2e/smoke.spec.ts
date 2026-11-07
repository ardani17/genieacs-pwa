import { expect, test } from "@playwright/test";

test("neutral entry renders on every supported viewport", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "GenieACS PWA" }),
  ).toBeVisible();
  expect(await page.textContent("body")).not.toMatch(/password|pppoe/i);
});
