import { PageHeader } from "@/components/page-header";
import { VpnSettings } from "@/features/vpn/profile-form";
export const dynamic = "force-dynamic";
export default function VpnPage() {
  return (
    <>
      <PageHeader
        title="VPN dan alamat ACS"
        description="Kelola profil tersimpan dan periksa koneksi jaringan ONT."
      />
      <VpnSettings />
    </>
  );
}
