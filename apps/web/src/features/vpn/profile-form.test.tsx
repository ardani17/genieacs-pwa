import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VpnProfileForm } from "./profile-form";
import { apiRequest } from "@/lib/api-client";
vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));
const api = vi.mocked(apiRequest);
const view = {
  revision: 2,
  server: "vpn.example.invalid",
  username: "fixture",
  passwordConfigured: true,
  routes: ["10.77.0.0/16"],
  mtu: 1400,
  acs: { mode: "auto-ppp", scheme: "http", host: null, port: 7547, path: "/" },
  updatedAt: "2026-11-08T00:00:00.000Z",
};
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValueOnce({
    ok: true,
    data: { status: "configured", view },
    requestId: "fixture",
  });
});
test("save failure retains the new desired profile and clears password material", async () => {
  api.mockResolvedValueOnce({
    ok: true,
    data: {
      view: { ...view, revision: 3, server: "vpn-fail.example.invalid" },
      desiredRevision: 3,
      applyState: "failed",
      applyError: "AUTH_FAILED",
    },
    requestId: "fixture",
  });
  const user = userEvent.setup();
  render(<VpnProfileForm />);
  const server = await screen.findByLabelText("Server VPN");
  await user.clear(server);
  await user.type(server, "vpn-fail.example.invalid");
  await user.click(screen.getByRole("button", { name: "Simpan profil" }));
  expect(
    await screen.findByText(/Profil tersimpan; koneksi gagal/),
  ).toBeVisible();
  expect(server).toHaveValue("vpn-fail.example.invalid");
  expect(screen.queryByLabelText("Password VPN")).not.toBeInTheDocument();
  const sent = JSON.parse(api.mock.calls[1][1]!.body as string);
  expect(sent.passwordAction).toBe("keep");
  expect(sent).not.toHaveProperty("password");
});
test("CAS conflict preserves local form; compare never forces a save", async () => {
  api.mockResolvedValueOnce({
    ok: false,
    error: { code: "CONFLICT", message: "stale", retryable: false },
    requestId: "conflict-fixture",
  });
  api.mockResolvedValueOnce({
    ok: true,
    data: {
      status: "configured",
      view: { ...view, revision: 3, server: "other.example.invalid" },
    },
    requestId: "fixture",
  });
  const user = userEvent.setup();
  render(
    <VpnProfileForm
      status={{
        state: "connected",
        desiredRevision: 2,
        appliedRevision: 2,
        interfaceName: "ppp0",
        localIp: "10.77.0.2",
        peerIp: "10.77.0.1",
        attempt: 1,
        nextAttemptAt: null,
        lastErrorCode: null,
        observedAt: "2026-11-08T00:00:00Z",
        routes: [],
      }}
    />,
  );
  const server = await screen.findByLabelText("Server VPN");
  await user.clear(server);
  await user.type(server, "local.example.invalid");
  await user.click(screen.getByRole("button", { name: "Simpan profil" }));
  expect(await screen.findByText(/Form lokal dipertahankan/)).toBeVisible();
  expect(server).toHaveValue("local.example.invalid");
  expect(screen.getByRole("button", { name: "Simpan profil" })).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Bandingkan dengan server" }),
  );
  await screen.findByText(/other.example.invalid/);
  expect(server).toHaveValue("local.example.invalid");
  expect(
    api.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
});
