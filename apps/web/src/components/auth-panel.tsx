import { Network } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-8">
        <Link
          href="/"
          className="mx-auto flex min-h-11 w-fit items-center gap-3 text-lg font-semibold"
        >
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Network aria-hidden="true" />
          </span>
          GenieACS{" "}
          <span className="font-normal text-muted-foreground">PWA</span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl" role="heading" aria-level={1}>
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Manajemen perangkat dalam satu ruang kerja.
        </p>
      </div>
    </main>
  );
}
