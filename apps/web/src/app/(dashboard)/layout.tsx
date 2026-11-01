import { redirect } from "next/navigation";
import {
  SessionProvider,
  type SessionState,
} from "@/components/session-provider";
import { Navigation } from "@/components/navigation";
import type { SessionDTO } from "@contracts/api.ts";

// Server-side session fetch (no-store): anonymous requests land on
// /login with a returnPath allowlisted to RELATIVE paths only. The
// backend re-checks permission on every action regardless.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initial: SessionState = { phase: "anonymous" };
  try {
    const cookie = (await import("next/headers")).cookies;
    const jar = await cookie();
    const res = await fetch(
      `${process.env.GENIEACS_UI_URL ?? "http://ui:7583"}/api/session`,
      {
        headers: {
          Cookie: `genieacs-ui-jwt=${jar.get("app-session")?.value ?? ""}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      },
    );
    if (res.ok) {
      const body = await res.json();
      if (body?.ok)
        initial = { phase: "authenticated", session: body.data as SessionDTO };
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
