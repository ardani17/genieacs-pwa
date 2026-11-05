import { PageHeader } from "@/components/page-header";
import { ProvisionEditor } from "@/features/admin/script-editors";

export const dynamic = "force-dynamic";

export default function AdminProvisionsPage() {
  return (
    <>
      <PageHeader
        title="Provision"
        description="Editor script provision dengan validasi native — kode tidak pernah dijalankan di browser."
      />
      <ProvisionEditor />
    </>
  );
}
