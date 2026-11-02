// Playwright global setup: logs the fixture identities in through the
// REAL BFF login route (Origin + X-App-Request enforced) and stores the
// storage states under artifacts/auth (git-ignored). No real secrets.
import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.PW_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "Fixture-Only-2026!";
const IDENTITIES = ["admin", "operator", "restricted"] as const;

export default async function globalSetup(config: FullConfig): Promise<void> {
  void config;
  const outDir = path.resolve(process.cwd(), "../../artifacts/auth");
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const identity of IDENTITIES) {
      const context = await browser.newContext();
      const page = await context.newPage();

      // Bounded retries bridge fresh-stack startup (engine snapshot
      // window); the FINAL state must still be a verified active
      // session — a stack that never comes up fails the run.
      let lastError = "unknown";
      let verified = false;
      for (let attempt = 0; attempt < 12 && !verified; ++attempt) {
        if (attempt > 0) await page.waitForTimeout(2500);
        try {
          const response = await page.request.post(
            `${BASE_URL}/api/app/login`,
            {
              headers: {
                Origin: BASE_URL,
                "X-App-Request": "1",
                "Content-Type": "application/json",
              },
              data: { username: identity, password: PASSWORD },
            },
          );
          if (!response.ok()) {
            lastError = `login ${response.status()}`;
            continue;
          }

          // A 200 alone is not proof: the session must introspect as
          // ACTIVE through the same cookie before the state is stored.
          const session = await page.request.get(`${BASE_URL}/api/app/session`);
          if (!session.ok()) {
            lastError = `introspection ${session.status()}`;
            continue;
          }
          const dto = (await session.json()) as { username?: string };
          if (dto.username !== identity) {
            lastError = `session mismatch ${String(dto.username)}`;
            continue;
          }
          verified = true;
        } catch (err) {
          lastError = String(err);
        }
      }
      if (!verified)
        throw new Error(
          `fixture session could not be established for ${identity}: ${lastError}`,
        );

      await context.storageState({
        path: path.join(outDir, `${identity}.json`),
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
