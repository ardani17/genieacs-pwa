import { vpnAction } from "@/server/vpn-routes";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return vpnAction(request, "diagnose");
}
