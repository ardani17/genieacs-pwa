import { PageHeader } from "@/components/page-header";
import { DeviceDetail } from "@/features/devices/device-detail";

export const dynamic = "force-dynamic";

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Detail Perangkat"
        description="Informasi, parameter, dan diagnosis perangkat dalam satu tempat."
      />
      <DeviceDetail deviceId={decodeURIComponent(id)} />
    </>
  );
}
