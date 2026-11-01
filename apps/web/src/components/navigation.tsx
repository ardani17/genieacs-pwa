"use client";

import { useRef, useState } from "react";
import { useSession } from "./session-provider";
import styles from "./navigation.module.css";

export interface NavItem {
  href: string;
  label: string;
  requiredResource?: string;
  minAccess?: 1 | 2 | 3;
}

// Route availability: modules not yet merged are hidden until they land
// (feature availability map) — navigation never links to unbuilt pages.
export const FEATURE_AVAILABILITY: Record<string, boolean> = {
  "/overview": false,
  "/devices": false,
  "/tasks": false,
  "/faults": false,
  "/diagnostics/logs": false,
  "/account/password": true,
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Ringkasan" },
  { href: "/devices", label: "Perangkat" },
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

export function Navigation() {
  const { state } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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

  const links = visible.map((item) => (
    <a key={item.href} href={item.href} className={styles.navLink}>
      {item.label}
    </a>
  ));

  const closeMenu = (focus = true) => {
    setMenuOpen(false);
    if (focus) menuButtonRef.current?.focus();
  };

  return (
    <>
      <nav
        aria-label="Navigasi utama"
        className={styles.sidebar}
        data-testid="main-nav"
      >
        {links}
      </nav>
      <nav
        aria-label="Navigasi utama"
        className={styles.bottomNav}
        data-testid="main-nav-mobile"
      >
        {visible.slice(0, 4).map((item) => (
          <a key={item.href} href={item.href} className={styles.bottomLink}>
            {item.label}
          </a>
        ))}
        <button
          ref={menuButtonRef}
          type="button"
          className={styles.bottomLink}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={() => setMenuOpen(true)}
        >
          Lainnya
        </button>
      </nav>
      {menuOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={styles.menuOverlay}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeMenu();
          }}
        >
          <div className={styles.menuPanel}>
            {links}
            <button type="button" onClick={() => closeMenu()}>
              Tutup
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
