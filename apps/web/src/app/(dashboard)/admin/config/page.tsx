import { PageHeader } from "@/components/page-header";
import { ConfigEditor } from "@/features/admin/config-editor";

export const dynamic = "force-dynamic";

export default function AdminConfigPage() {
  return (
    <>
      <PageHeader
        title="Konfigurasi"
        description="Nilai konfigurasi engine sebagai ekspresi — round-trip persis, kredensial disembunyikan."
      />
      <ConfigEditor canRevealSecrets />
    </>
  );
}
