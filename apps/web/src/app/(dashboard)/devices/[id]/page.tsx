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
      <h1>Detail Perangkat</h1>
      <DeviceDetail deviceId={decodeURIComponent(id)} />
    </>
  );
}
