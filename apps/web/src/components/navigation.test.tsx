import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Navigation } from "./navigation";
import { SessionProvider } from "./session-provider";
import type { SessionDTO } from "@contracts/api.ts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/devices/TEST-DEVICE-00001",
}));

function renderNavigation(permissionSets: SessionDTO["permissionSets"] = []) {
  return render(
    <SessionProvider
      initial={{
        phase: "authenticated",
        session: {
          username: "operator",
          roles: ["operator"],
          permissionSets,
          uiConfig: {},
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          configRevision: "test",
          appVersion: "test",
          upstreamVersion: "1.2.16",
        },
      }}
    >
      <Navigation />
    </SessionProvider>,
  );
}

test("native nested permission sets expose the authorized Admin link", () => {
  renderNavigation([[{ config: { access: 3, filter: true } }]]);
  expect(
    within(screen.getByTestId("main-nav")).getByRole("link", {
      name: /^Admin$/,
    }),
  ).toBeVisible();
});

test("navigation marks the device section active and hides unavailable routes", () => {
  renderNavigation();
  const nav = within(screen.getByTestId("main-nav"));
  expect(nav.getByRole("link", { name: "Perangkat" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(nav.getByRole("link", { name: "Ringkasan" })).not.toHaveAttribute(
    "aria-current",
  );
  // M05-D/M05-E made /tasks and /faults available; logs stay gated
  // until their milestone merges.
  expect(
    screen.queryByRole("link", { name: "Log global" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Task" }).length).toBeGreaterThan(
    0,
  );
  expect(
    screen.getAllByRole("link", { name: "Diagnosis" }).length,
  ).toBeGreaterThan(0);
});

test("mobile menu traps focus, closes with Escape, and returns focus", async () => {
  const user = userEvent.setup();
  renderNavigation();
  const trigger = screen.getByRole("button", { name: "Lainnya" });
  await user.click(trigger);
  const menu = screen.getByRole("dialog", { name: "Menu" });
  expect(menu).toHaveAttribute("aria-modal", "true");
  expect(menu.contains(document.activeElement)).toBe(true);
  await user.tab({ shift: true });
  expect(menu.contains(document.activeElement)).toBe(true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});
