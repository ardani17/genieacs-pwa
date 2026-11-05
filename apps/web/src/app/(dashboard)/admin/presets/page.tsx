import { PageHeader } from "@/components/page-header";
import { PresetEditor } from "@/features/admin/preset-editor";

export const dynamic = "force-dynamic";

export default function AdminPresetsPage() {
  return (
    <>
      <PageHeader
        title="Preset"
        description="Kelola preset beserta kondisi, event dan provision — round-trip konfigurasi native."
      />
      <PresetEditor />
    </>
  );
}
