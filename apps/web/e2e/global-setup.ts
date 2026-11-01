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
      const response = await page.request.post(`${BASE_URL}/api/app/login`, {
        headers: {
          Origin: BASE_URL,
          "X-App-Request": "1",
          "Content-Type": "application/json",
        },
        data: { username: identity, password: PASSWORD },
      });
      if (!response.ok())
        throw new Error(`fixture BFF login failed for ${identity}`);
      await context.storageState({
        path: path.join(outDir, `${identity}.json`),
      });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
