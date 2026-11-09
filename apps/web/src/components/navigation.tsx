"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Settings,
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
import { hasResourceAccess } from "@/lib/permissions";
import { useSession } from "./session-provider";
import {
  FEATURE_AVAILABILITY,
  NAV_ITEMS,
  type NavItem,
} from "./navigation-items";

const icons = {
  "/overview": LayoutDashboard,
  "/devices": Cable,
  "/tasks": ListChecks,
  "/faults": Activity,
  "/diagnostics/logs": ScrollText,
  "/settings/vpn": Network,
  "/account/password": CircleUserRound,
  "/admin/config": Settings,
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
          hasResourceAccess(
            session,
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
          "flex min-h-(--control-height-sm) items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
          active(item.href)
            ? "bg-accent text-primary"
            : "text-muted-foreground",
          mobile && "min-h-14 flex-1 flex-col gap-1 px-2 py-2 text-xs",
        )}
      >
        <Icon
          className={cn("size-4 shrink-0", mobile && "size-5")}
          aria-hidden="true"
        />
        {item.label}
      </Link>
    );
  };
  const brand = (
    <Link
      href="/overview"
      className="flex min-h-11 items-center gap-3 font-semibold tracking-tight"
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Network className="size-5" aria-hidden="true" />
      </span>
      <span>
        GenieACS <span className="font-normal text-muted-foreground">PWA</span>
      </span>
    </Link>
  );
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:p-4"
      >
        Lewati ke konten
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col overflow-y-auto border-r bg-card p-4 lg:flex">
        {brand}
        <p className="mb-2 mt-6 text-xs font-medium tracking-wider text-muted-foreground">
          RUANG KERJA
        </p>
        <nav
          aria-label="Navigasi utama"
          data-testid="main-nav"
          className="space-y-1"
        >
          {visible.map((item) => link(item))}
        </nav>
        <div className="mt-auto border-t pt-4">
          <p className="text-xs text-muted-foreground">Masuk sebagai</p>
          <p className="mt-1 truncate text-sm font-medium">
            {session?.username ?? "Pengguna"}
          </p>
        </div>
      </aside>
      <header className="flex items-center justify-between border-b bg-card px-4 py-2 lg:hidden">
        {brand}
        <CircleUserRound
          className="size-5 text-muted-foreground"
          aria-hidden="true"
        />
      </header>
      <nav
        aria-label="Navigasi utama"
        data-testid="main-nav-mobile"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
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
