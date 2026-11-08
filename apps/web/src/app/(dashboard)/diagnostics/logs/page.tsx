import { PageHeader } from "@/components/page-header";
import { LogSearch } from "@/features/logs/log-search";
export const dynamic = "force-dynamic";
export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="Log global"
        description="Cari kejadian dan telusuri requestId yang sudah direduksi dari data rahasia."
      />
      <LogSearch
        initialRequestId={
          typeof params.requestId === "string"
            ? params.requestId.slice(0, 256)
            : ""
        }
      />
    </>
  );
}
