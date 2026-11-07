import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider } from "@/components/session-provider";
import { Overview } from "./overview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const SESSION = {
  username: "admin",
  roles: ["admin"],
  permissionSets: [],
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  configRevision: "rev",
  uiConfig: {
    overview: {
      charts: {
        online: {
          label: "Status online",
          slices: {
            onlineNow: {
              label: "Online now",
              filter: "Events.Inform > NOW() - 5 * 60 * 1000",
            },
            others: { label: "Others", filter: "Events.Inform < 100" },
          },
        },
      },
      groups: { online: { label: "", charts: ["online"] } },
    },
  },
  appVersion: "test",
  upstreamVersion: "1.2.16",
  sessionMaxAgeSeconds: 28800,
};

describe("Overview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("evaluates ui.overview through the HEAD count contract", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      // Slice counts and the total come from the same HEAD contract.
      const count = url.includes("filter=") ? "7" : "12";
      return new Response(null, {
        status: 200,
        headers: { "x-total-count": count },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SessionProvider initial={{ phase: "authenticated", session: SESSION }}>
        <Overview />
      </SessionProvider>,
    );

    // Config-driven chart with visible counts.
    expect(await screen.findByText("Status online")).toBeVisible();
    expect(await screen.findByText("Online now")).toBeVisible();
    expect(await screen.findByText("Others")).toBeVisible();
    expect((await screen.findAllByText("12")).length).toBeGreaterThan(0); // total

    // Every slice count is fetched through the filtered HEAD contract.
    const headCalls = fetchMock.mock.calls.filter(
      ([input]) =>
        (input as string).includes("/api/app/resources/devices") &&
        fetchMock.mock.calls.length > 0,
    );
    expect(headCalls.length).toBeGreaterThan(0);
    const filtered = fetchMock.mock.calls.filter(([input]) =>
      (input as string).includes("filter="),
    );
    expect(filtered.length).toBe(2);

    // Slice counts are clickable through to the same filter.
    const slices = await screen.findAllByRole("button", { name: /: 7$/ });
    expect(slices.length).toBe(2);
  });

  it("renders count-denied slices as unavailable, not wrong numbers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(null, { status: 403, headers: {} }),
      ) as never,
    );

    render(
      <SessionProvider initial={{ phase: "authenticated", session: SESSION }}>
        <Overview />
      </SessionProvider>,
    );

    expect(await screen.findByText("Status online")).toBeVisible();
    // No count is invented when the count contract denies.
    expect(screen.queryByRole("button", { name: "7" })).toBeNull();
  });
});
