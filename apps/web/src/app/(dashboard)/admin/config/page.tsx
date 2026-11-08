import { PageHeader } from "@/components/page-header";
import { ConfigEditor } from "@/features/admin/config-editor";
import { cookies } from "next/headers";
import { APP_COOKIE_NAME, engineFetch } from "@/server/genieacs-client";
import { hasResourceAccess } from "@/lib/permissions";
import type { SessionDTO } from "@contracts/api.ts";

export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  // Reveal requires config:3 — resolved SERVER-side from the real
  // session; the browser never receives the flag unearned. cookies()
  // yields per-cookie objects: read the raw native JWT value under the
  // ONE cookie-name contract.
  const cookie = (await cookies()).get(APP_COOKIE_NAME)?.value ?? null;
  let canReveal = false;
  if (cookie) {
    try {
      const res = await engineFetch("/api/session", { cookie });
      if (res.ok) {
        const dto = (await res.json()) as SessionDTO;
        canReveal = hasResourceAccess(dto, "config", 3);
      }
    } catch {
      canReveal = false;
    }
  }
  return (
    <>
      <PageHeader
        title="Konfigurasi"
        description="Nilai konfigurasi engine sebagai ekspresi — round-trip persis, kredensial disembunyikan."
      />
      <ConfigEditor canRevealSecrets={canReveal} />
    </>
  );
}
