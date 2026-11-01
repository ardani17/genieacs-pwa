import { redirect } from "next/navigation";
import {
  SessionProvider,
  type SessionState,
} from "@/components/session-provider";
import { Navigation } from "@/components/navigation";
import {
  APP_COOKIE_NAME,
  GENIEACS_UI_URL,
} from "@/server/genieacs-client";
import type { SessionDTO } from "@contracts/api.ts";

// Server-side session fetch (no-store): anonymous requests land on
// /login. The NATIVE /api/session returns the SessionDTO directly (no
// ok/data envelope), and the session cookie is read under the single
// BFF cookie contract (APP_COOKIE_NAME). The backend re-checks
// permission on every action regardless.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initial: SessionState = { phase: "anonymous" };
  try {
    const cookie = (await import("next/headers")).cookies;
    const jar = await cookie();
    const res = await fetch(`${GENIEACS_UI_URL}/api/session`, {
      headers: {
        Cookie: `${APP_COOKIE_NAME}=${jar.get(APP_COOKIE_NAME)?.value ?? ""}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      // Native DTO shape: { username, roles, ... } at the top level.
      const dto = (await res.json()) as SessionDTO | null;
      if (dto && typeof dto.username === "string" && dto.username)
        initial = { phase: "authenticated", session: dto };
    }
  } catch {
    // Engine unreachable: keep anonymous; pages handle 503 states.
  }

  if (initial.phase === "anonymous") redirect("/login");

  return (
    <SessionProvider initial={initial}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Navigation />
        <main style={{ flex: 1, padding: "var(--space-16)" }}>{children}</main>
      </div>
    </SessionProvider>
  );
}
