import { PageHeader } from "@/components/page-header";
import { Suspense } from "react";
import { DeviceList } from "@/features/devices/device-list";

export const dynamic = "force-dynamic";

export default function DevicesPage() {
  return (
    <>
      <PageHeader
        title="Perangkat"
        description="Temukan perangkat, telusuri parameter, dan lihat hasil diagnosis."
      />
      <Suspense fallback={<p>Memuat daftar…</p>}>
        <DeviceList />
      </Suspense>
    </>
  );
}
