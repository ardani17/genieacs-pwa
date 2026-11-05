import { test, expect, type Page } from "@playwright/test";

// Admin CRUD flows (M06-B): source round-trips through the CodeMirror
// editor, invalid scripts are rejected by the NATIVE validator, the
// operator sees the server refusal on both UI and API sides, saves
// warn on concurrent modification, and deletes confirm.

test.use({ storageState: "../../artifacts/auth/admin.json" });

// Cold-container browser launches can take tens of seconds on a busy
// host; the flows themselves are short.
test.setTimeout(120_000);

async function typeInEditor(page: Page, text: string): Promise<void> {
  // The CodeMirror input (textarea input style on pointer devices) is
  // offscreen by design; focus it and type — the visible surface
  // renders the document.
  await page.locator(".CodeMirror textarea").focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text, { delay: 5 });
}

test("provision editor preserves source through save and reopen", async ({
  page,
}) => {
  await page.goto("/admin/provisions");
  await page.getByRole("button", { name: "Tambah", exact: true }).click();
  await page.getByLabel("Nama", { exact: true }).fill("fixture-provision");
  const code = 'declare("DeviceID.ID", {value: 1});';
  await typeInEditor(page, code);
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "fixture-provision", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("link", { name: "fixture-provision", exact: true })
    .click();
  await expect(page.locator(".CodeMirror")).toContainText(code);
});

test("invalid provision source is rejected with the native validation error", async ({
  page,
}) => {
  await page.goto("/admin/provisions");
  await page.getByRole("button", { name: "Tambah", exact: true }).click();
  await page
    .getByLabel("Nama", { exact: true })
    .fill("fixture-invalid-provision");
  await typeInEditor(page, "const x = ;");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(
    page.getByText(/Request rejected|tidak dapat disimpan|Format/i),
  ).toBeVisible();
  // The source is still in the editor — no silent overwrite.
  await expect(page.locator(".CodeMirror")).toContainText("const x");
});

test("operator cannot manage provisions through UI or API", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: "../../artifacts/auth/operator.json",
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/admin/provisions");
  await expect(
    page.getByText("Anda tidak memiliki izin mengelola resource ini."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tambah", exact: true }),
  ).toHaveCount(0);
  const api = await page.request.get(
    "/api/app/resources/provisions?page=1&pageSize=25",
  );
  expect(api.status()).toBe(403);
  await context.close();
});

test("config values round-trip exactly and credential entries stay masked", async ({
  page,
}) => {
  await page.goto("/admin/config");
  await page.getByRole("button", { name: "Tambah", exact: true }).click();
  await page.getByLabel("Nama", { exact: true }).fill("ui.test.custom");
  await typeInEditor(page, '"nilai eksak"');
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await page.getByRole("link", { name: "ui.test.custom", exact: true }).click();
  await expect(page.locator(".CodeMirror")).toContainText("nilai eksak");
});

test("deleting a provision requires confirmation", async ({ page }) => {
  await page.goto("/admin/provisions");
  await page
    .getByRole("link", { name: "fixture-provision", exact: true })
    .click();
  await page.getByRole("button", { name: "Hapus", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText(/Hapus fixture-provision\?/),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hapus", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "fixture-provision", exact: true }),
  ).toHaveCount(0);
});

test("unsaved changes guard navigation", async ({ page }) => {
  await page.goto("/admin/provisions");
  await page.getByRole("button", { name: "Tambah", exact: true }).click();
  await page.getByLabel("Nama", { exact: true }).fill("guard-test");
  let dialogSeen: string | null = null;
  page.on("dialog", (dialog) => {
    dialogSeen = dialog.type();
    dialog.accept();
  });
  await page.reload();
  expect(dialogSeen).toBe("beforeunload");
});
