import { PageHeader } from "@/components/page-header";
import { ConfigEditor } from "@/features/admin/config-editor";
import { cookies } from "next/headers";
import { engineFetch, nativeCookieFrom } from "@/server/genieacs-client";

export const dynamic = "force-dynamic";

export default async function AdminConfigPage() {
  // Reveal requires config:3 — resolved SERVER-side from the real
  // session; the browser never receives the flag unearned.
  const cookie = nativeCookieFrom(
    (await cookies()).get("cookie")?.value ?? null,
  );
  let canReveal = false;
  if (cookie) {
    try {
      const res = await engineFetch("/api/session", { cookie });
      if (res.ok) {
        const dto = (await res.json()) as {
          permissionSets?: Record<string, { access?: number }>[];
        };
        canReveal = (dto.permissionSets ?? []).some(
          (set) =>
            set["config"]?.access !== undefined && set["config"].access >= 3,
        );
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
