import { PageHeader } from "@/components/page-header";
import { VirtualParameterEditor } from "@/features/admin/script-editors";

export const dynamic = "force-dynamic";

export default function AdminVirtualParametersPage() {
  return (
    <>
      <PageHeader
        title="Virtual parameter"
        description="Editor script virtual parameter dengan validasi native."
      />
      <VirtualParameterEditor />
    </>
  );
}
