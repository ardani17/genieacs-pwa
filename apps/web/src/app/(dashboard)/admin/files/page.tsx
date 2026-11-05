import { PageHeader } from "@/components/page-header";
import { FileManager } from "@/features/admin/files";

export const dynamic = "force-dynamic";

export default function AdminFilesPage() {
  return (
    <>
      <PageHeader
        title="File firmware"
        description="Unggah stream ≤100MiB dengan progres/batal, unduh dan hapus berizin."
      />
      <FileManager />
    </>
  );
}
