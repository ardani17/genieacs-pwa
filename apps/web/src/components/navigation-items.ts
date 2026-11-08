// Navigation data (split from navigation.tsx so the component file
// exports components only): route availability and the nav item list
// live here and are imported by the Navigation component and tests.

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
  "/diagnostics/logs": true,
  "/settings/vpn": true,
  "/account/password": true,
  "/admin/presets": true,
  "/admin/provisions": true,
  "/admin/virtual-parameters": true,
  "/admin/config": true,
  "/admin/users": true,
  "/admin/permissions": true,
  "/admin/files": true,
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
    minAccess: 2,
  },
  {
    href: "/settings/vpn",
    label: "VPN",
    requiredResource: "vpn",
    minAccess: 1,
  },
  {
    href: "/admin/config",
    label: "Admin",
    requiredResource: "config",
    minAccess: 1,
  },
  { href: "/account/password", label: "Akun" },
];
