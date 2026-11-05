import { PageHeader } from "@/components/page-header";
import { PermissionManager } from "@/features/admin/permissions";

export const dynamic = "force-dynamic";

export default function AdminPermissionsPage() {
  return (
    <>
      <PageHeader
        title="Permission"
        description="Akses, filter dan validator per role — termasuk vpn dan logs."
      />
      <PermissionManager />
    </>
  );
}
