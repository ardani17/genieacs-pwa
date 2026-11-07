import { PageHeader } from "@/components/page-header";
import { Overview } from "@/features/overview/overview";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Ringkasan"
        description="Pantau distribusi dan kondisi perangkat dari instalasi GenieACS Anda."
      />
      <Overview />
    </>
  );
}
