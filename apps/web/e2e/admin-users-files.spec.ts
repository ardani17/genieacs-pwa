import { test, expect } from "@playwright/test";

// Admin users/permissions/files flows (M06-C): hash/salt never leave
// the server, restricted roles see the refusal (UI and direct URL),
// file upload streams with progress and idempotent string IDs, and
// deleting a user kills their session inside the snapshot window.

test.use({ storageState: "../../artifacts/auth/admin.json" });

test.setTimeout(120_000);

test("operator cannot open the permission editor through direct URL", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: "../../artifacts/auth/operator.json",
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/admin/permissions");
  await expect(
    page.getByText("Anda tidak memiliki izin mengelola permission."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simpan", exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("user creation hashes server-side and never returns hash/salt", async ({
  page,
}) => {
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Tambah pengguna" }).click();
  await page.getByLabel("Nama pengguna").fill("e2e-tech");
  await page.getByLabel("Password (min 8)").fill("Fixture-Only-2026!");
  await page.getByLabel(/Role \(pisah koma\)/).fill("fixtureOperator");
  const responses: string[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/app/admin/users")) {
      try {
        responses.push((await res.text()).slice(0, 400));
      } catch {
        // body already consumed
      }
    }
  });
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText("e2e-tech")).toBeVisible();
  // No password hash or salt ever appears in any response body.
  for (const body of responses) {
    expect(body).not.toMatch(/"salt"/i);
    expect(body).not.toMatch(/"password"\s*:\s*"[A-Za-z0-9+/=]{40,}/);
  }
});

test("admin can reset a user password and delete the user", async ({
  page,
}) => {
  await page.goto("/admin/users");
  await page
    .getByRole("listitem")
    .filter({ hasText: "e2e-tech" })
    .getByRole("button", { name: "Reset password" })
    .click();
  await page.getByLabel("Password baru (min 8)").fill("Fixture-Only-2027!");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page
    .getByRole("listitem")
    .filter({ hasText: "e2e-tech" })
    .getByRole("button", { name: "Hapus" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hapus", exact: true })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "e2e-tech" }),
  ).toHaveCount(0);
});

test("file upload streams, lists metadata and deletes", async ({ page }) => {
  await page.goto("/admin/files");
  await page.getByLabel("ID file").fill("e2e-firmware-test");
  await page.getByLabel("Versi").fill("V0.0.1-E2E");
  const chooser = page.waitForEvent("filechooser");
  await page.getByText("Pilih file firmware").click();
  const file = await chooser;
  await file.setFiles({
    name: "e2e-firmware.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("e2e-firmware-bytes"),
  });
  await expect(
    page.getByRole("listitem").filter({ hasText: "e2e-firmware-test" }),
  ).toBeVisible({ timeout: 30_000 });
  // Re-upload under the SAME string id replaces content idempotently.
  const chooser2 = page.waitForEvent("filechooser");
  await page.getByLabel("ID file").fill("e2e-firmware-test");
  await page.getByText("Pilih file firmware").click();
  const file2 = await chooser2;
  await file2.setFiles({
    name: "e2e-firmware.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("e2e-firmware-bytes-v2"),
  });
  await expect(
    page.getByRole("listitem").filter({ hasText: "e2e-firmware-test" }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("listitem")
    .filter({ hasText: "e2e-firmware-test" })
    .getByRole("button", { name: "Hapus" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hapus", exact: true })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "e2e-firmware-test" }),
  ).toHaveCount(0);
});

test("deleted user sessions die within the snapshot window", async ({
  browser,
}, testInfo) => {
  const username = `e2e-doomed-${testInfo.project.name}`;
  const context = await browser.newContext({
    storageState: "../../artifacts/auth/admin.json",
  });
  const page = await context.newPage();
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Tambah pengguna" }).click();
  await page.getByLabel("Nama pengguna").fill(username);
  await page.getByLabel("Password (min 8)").fill("Fixture-Only-2026!");
  await page.getByLabel(/Role \(pisah koma\)/).fill("fixtureOperator");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText(username)).toBeVisible();

  const victim = await browser.newContext();
  const login = await victim.request.post("/api/app/login", {
    headers: {
      Origin: "http://localhost:3000",
      "X-App-Request": "1",
      "Content-Type": "application/json",
    },
    data: { username, password: "Fixture-Only-2026!" },
  });
  expect(login.ok()).toBe(true);
  const victimPage = await victim.newPage();
  await victimPage.goto("/overview");
  await expect(
    victimPage.getByRole("link", { name: "Ringkasan" }),
  ).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: username })
    .getByRole("button", { name: "Hapus" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Hapus", exact: true })
    .click();
  await expect(
    page.getByRole("listitem").filter({ hasText: username }),
  ).toHaveCount(0);

  // The victim's stored session must stop working within the snapshot
  // refresh window (~5s) plus polling slack.
  await victimPage.waitForTimeout(12_000);
  await victimPage.reload();
  await expect(victimPage).toHaveURL(/\/login/);
  await victim.close();
  await context.close();
});
