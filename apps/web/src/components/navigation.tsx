"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Cable,
  CircleUserRound,
  LayoutDashboard,
  ListChecks,
  MoreHorizontal,
  Network,
  ScrollText,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { cn } from "@/lib/utils";
import { useSession } from "./session-provider";

export interface NavItem {
  href: string;
  label: string;
  requiredResource?: string;
  minAccess?: 1 | 2 | 3;
}

// Route availability: modules not yet merged are hidden until they land
// (feature availability map) — navigation never links to unbuilt pages.
export const FEATURE_AVAILABILITY: Record<string, boolean> = {
  "/overview": true,
  "/devices": true,
  "/devices/[id]": true,
  "/tasks": true,
  "/faults": true,
  "/diagnostics/logs": false,
  "/account/password": true,
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Ringkasan" },
  { href: "/devices", label: "Perangkat" },
  { href: "/tasks", label: "Task" },
  { href: "/faults", label: "Diagnosis" },
  {
    href: "/diagnostics/logs",
    label: "Log global",
    requiredResource: "logs",
    minAccess: 3,
  },
  { href: "/account/password", label: "Akun" },
];

function hasResource(
  session: { permissionSets: Record<string, { access: number }>[] },
  resource: string,
  minAccess: number,
): boolean {
  return session.permissionSets.some((set) => {
    const entry = Object.values(set).find(
      (v) => (v as { resource?: string }).resource === undefined,
    );
    void entry;
    return Object.entries(set).some(
      ([key, value]) =>
        key === resource && (value as { access: number }).access >= minAccess,
    );
  });
}

const icons = {
  "/overview": LayoutDashboard,
  "/devices": Cable,
  "/tasks": ListChecks,
  "/faults": Activity,
  "/diagnostics/logs": ScrollText,
  "/account/password": CircleUserRound,
};
export function Navigation() {
  const { state } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const session = state.phase === "authenticated" ? state.session : null;
  const visible = NAV_ITEMS.filter(
    (item) =>
      FEATURE_AVAILABILITY[item.href] === true &&
      (!item.requiredResource ||
        (session &&
          hasResource(
            session as unknown as {
              permissionSets: Record<string, { access: number }>[];
            },
            item.requiredResource,
            item.minAccess ?? 1,
          ))),
  );
  const active = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const link = (item: NavItem, mobile = false) => {
    const Icon = icons[item.href as keyof typeof icons];
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active(item.href) ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
          active(item.href)
            ? "bg-accent text-primary"
            : "text-muted-foreground",
          mobile && "flex-1 flex-col gap-1 px-2 py-2 text-xs",
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {item.label}
      </Link>
    );
  };
  const brand = (
    <a
      href="/overview"
      className="flex min-h-11 items-center gap-3 font-semibold tracking-tight"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Network className="size-5" aria-hidden="true" />
      </span>
      <span>
        GenieACS <span className="font-normal text-muted-foreground">PWA</span>
      </span>
    </a>
  );
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:p-4"
      >
        Lewati ke konten
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card p-6 md:flex">
        {brand}
        <p className="mb-3 mt-10 text-xs font-medium tracking-wider text-muted-foreground">
          RUANG KERJA
        </p>
        <nav
          aria-label="Navigasi utama"
          data-testid="main-nav"
          className="space-y-2"
        >
          {visible.map((item) => link(item))}
        </nav>
        <div className="mt-auto border-t pt-5">
          <p className="text-xs text-muted-foreground">Masuk sebagai</p>
          <p className="mt-1 truncate text-sm font-medium">
            {session?.username ?? "Pengguna"}
          </p>
        </div>
      </aside>
      <header className="flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        {brand}
        <CircleUserRound
          className="size-5 text-muted-foreground"
          aria-hidden="true"
        />
      </header>
      <nav
        aria-label="Navigasi utama"
        data-testid="main-nav-mobile"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {visible.slice(0, 3).map((item) => link(item, true))}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto min-h-14 flex-1 flex-col gap-1 px-2 py-2 text-xs"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
              Lainnya
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-xl">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
              <SheetDescription>
                Pilih halaman ruang kerja Anda.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-2 px-4 pb-8">
              {visible.map((item) => (
                <SheetClose asChild key={item.href}>
                  {link(item)}
                </SheetClose>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </>
  );
}
