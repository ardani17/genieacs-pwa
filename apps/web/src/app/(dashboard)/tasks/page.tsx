import { PageHeader } from "@/components/page-header";
import { StagingPanel } from "@/features/tasks/staging-panel";

export const dynamic = "force-dynamic";

export default function TasksPage() {
  return (
    <>
      <PageHeader
        title="Task"
        description="Tinjau task yang ditahan sebelum dikirim — satu operasi sekali kirim, tanpa antrean ulang otomatis."
      />
      <StagingPanel />
    </>
  );
}
