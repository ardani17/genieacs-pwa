import { Suspense } from "react";
import { DeviceList } from "@/features/devices/device-list";

export const dynamic = "force-dynamic";

export default function DevicesPage() {
  return (
    <>
      <h1>Perangkat</h1>
      <Suspense fallback={<p>Memuat daftar…</p>}>
        <DeviceList />
      </Suspense>
    </>
  );
}
