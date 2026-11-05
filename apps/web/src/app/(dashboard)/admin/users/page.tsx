import { PageHeader } from "@/components/page-header";
import { UserManager } from "@/features/admin/users";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun dan role — hash password tetap di server."
      />
      <UserManager />
    </>
  );
}
