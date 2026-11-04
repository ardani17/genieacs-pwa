// WAN editor behavior tests (M05-D). The plan's sample spec is a
// Playwright browser flow; the same payload/outcome assertions are
// covered here as component tests (jsdom) plus the browser flow in
// e2e/device-commands.spec.ts.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WanEditor } from "./wan-editor";
import type { ApiResult } from "@contracts/api.ts";

const ROOT = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1";
const WAN_IP = `${ROOT}.WANIPConnection`;
const WAN_IP_1 = `${WAN_IP}.1`;

function leaf(value: unknown, type = "xsd:string", writable = true) {
  return { value: [value, type], writable };
}

function flatZteDevice(firmware: string) {
  const d: Record<string, unknown> = {
    "DeviceID.ID": leaf("TEST-F670"),
    "DeviceID.Manufacturer": leaf("ZTE"),
    "DeviceID.ProductClass": leaf("F670"),
    "InternetGatewayDevice.DeviceInfo.SoftwareVersion": leaf(firmware),
    "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": leaf(
      "http://192.0.2.99:7547/",
    ),
    [WAN_IP]: { writable: true },
  };
  for (const base of [WAN_IP_1, `${ROOT}.WANPPPConnection.1`]) {
    for (const [name, value, type, writable] of [
      ["Name", "", "xsd:string", true],
      ["Enable", false, "xsd:boolean", true],
      ["ConnectionType", "IP_Routed", "xsd:string", true],
      [
        "PossibleConnectionTypes",
        "IP_Routed,PPPoE_Bridged",
        "xsd:string",
        false,
      ],
      ["X_ZTE-COM_ServiceList", "", "xsd:string", true],
      ["X_ZTE-COM_VLANEnable", 0, "xsd:unsignedInt", true],
      ["X_ZTE-COM_VLANID", 0, "xsd:unsignedInt", true],
      ["X_ZTE-COM_8021P", 0, "xsd:unsignedInt", true],
      ["NATEnabled", true, "xsd:boolean", true],
      ["Username", "", "xsd:string", true],
      ["Password", "", "xsd:string", true],
      ["AddressingType", "DHCP", "xsd:string", true],
      ["ExternalIPAddress", "0.0.0.0", "xsd:string", true],
      ["SubnetMask", "0.0.0.0", "xsd:string", true],
      ["DefaultGateway", "0.0.0.0", "xsd:string", true],
      ["DNSServers", "", "xsd:string", true],
      ["X_ZTE-COM_LanInterface", "", "xsd:string", true],
    ] as const)
      d[`${base}.${name}`] = leaf(value, type, writable);
  }
  d["InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID"] = leaf("Lab");
  return d;
}

function mockFetch(firmware: string, wanProfile = true) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/wan"))
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            operationId: "op-1",
            deviceId: "TEST-F670",
            state: "succeeded",
            phases: [{ name: "write", state: "succeeded", taskIds: ["t1"] }],
          },
          requestId: "test",
        }),
        { status: 200 },
      );
    if (path.endsWith("/profile"))
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            profile: {
              id: "zte-f670",
              vendor: "zte",
              model: "F670",
              firmware,
              verified: wanProfile,
              wan: wanProfile,
              wifiWritable: wanProfile,
              paths: {},
            },
          },
          requestId: "test",
        } satisfies ApiResult<unknown>),
        { status: 200 },
      );
    return new Response(
      JSON.stringify({
        ok: true,
        data: flatZteDevice(firmware),
        requestId: "test",
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WanEditor", () => {
  it("enables the editor on verified firmware", async () => {
    mockFetch("V6.0.10P3N19");
    render(
      <WanEditor
        deviceId="TEST-F670"
        collection={WAN_IP}
        instance={WAN_IP_1}
      />,
    );
    // F670 P3N19 advertises PPPoE_Bridged but the verified correction
    // is IP_Bridged — the mode list comes from the capability model.
    await waitFor(() => expect(screen.getByText("Terapkan")).toBeEnabled());
    expect(screen.queryByText(/belum terverifikasi/)).toBeNull();
  });

  it("stays read-only on unsupported firmware", async () => {
    mockFetch("unknown-version", false);
    render(
      <WanEditor
        deviceId="TEST-F670"
        collection={WAN_IP}
        instance={WAN_IP_1}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/belum terverifikasi untuk perubahan WAN/),
      ).toBeVisible(),
    );
    expect(screen.queryByRole("button", { name: "Terapkan" })).toBeNull();
  });

  it("omits the password from the payload when the existing password stays blank", async () => {
    mockFetch("V6.0.10P3N19");
    const fetchMock = vi.mocked(globalThis.fetch);
    render(
      <WanEditor
        deviceId="TEST-F670"
        collection={WAN_IP}
        instance={WAN_IP_1}
      />,
    );
    await waitFor(() => expect(screen.getByText("Terapkan")).toBeEnabled());
    // Submit without typing any password.
    await userEvent.click(screen.getByText("Terapkan"));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/wan") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const wanCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/wan") && init?.method === "POST",
    );
    const body = JSON.parse((wanCall?.[1]?.body as string) ?? "{}");
    // Blank password = keep: sent as empty string, never a stored
    // secret, and the server omits the Password parameter entirely.
    expect(body.settings.password).toBe("");
  });

  it("never renders success when the connection drops", async () => {
    mockFetch("V6.0.10P3N19");
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/profile"))
        return new Response(
          JSON.stringify({
            ok: true,
            data: { profile: { verified: true, wan: true } },
            requestId: "t",
          }),
          { status: 200 },
        );
      if (path.endsWith("/wan") && typeof input === "string")
        return Promise.reject(new TypeError("network dropped"));
      return new Response(
        JSON.stringify({
          ok: true,
          data: flatZteDevice("V6.0.10P3N19"),
          requestId: "t",
        }),
        { status: 200 },
      );
    });
    render(
      <WanEditor
        deviceId="TEST-F670"
        collection={WAN_IP}
        instance={WAN_IP_1}
      />,
    );
    await waitFor(() => expect(screen.getByText("Terapkan")).toBeEnabled());
    await userEvent.click(screen.getByText("Terapkan"));
    await waitFor(() =>
      expect(screen.getByText(/Hasil belum terkonfirmasi/)).toBeVisible(),
    );
    expect(screen.queryByText("Berhasil", { exact: true })).toBeNull();
  });
});
