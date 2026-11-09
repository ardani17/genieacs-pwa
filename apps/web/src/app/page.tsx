import { Network } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
export default function Home() {
  return (
    <main className="app-shell py-16">
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4">
          <Network className="size-10 text-primary" aria-hidden="true" />
          <PageHeader
            title="GenieACS PWA"
            description="Pantau perangkat, telusuri parameter, dan periksa koneksi dalam satu ruang kerja."
          />
          <Button asChild>
            <Link href="/login">Masuk ke ruang kerja</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
