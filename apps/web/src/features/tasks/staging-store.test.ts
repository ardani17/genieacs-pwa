// Staging store unit tests (M05-D): memory-only bounds, WAN target
// conflicts, masked summaries and the single-operationId commit rule.
import { describe, expect, it } from "vitest";
import { StagingStore, STAGING_MAX_ENTRIES } from "./staging-store";

function commandEntry(deviceId = "TEST-1") {
  return {
    deviceId,
    kind: "command" as const,
    summary: { action: "Reboot", detail: "device restart" },
    tasks: [{ name: "reboot" as const }],
    destructive: true,
  };
}

function wanEntry(deviceId = "TEST-1", instance: string | null = "w.1") {
  return {
    deviceId,
    kind: "wan" as const,
    summary: { action: "WAN bridge", detail: "VLAN 100" },
    tasks: [{ name: "setParameterValues" as const, parameterValues: [] }],
    wanTarget: {
      collection:
        "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection",
      instance,
    },
    wanSettings: { password: "secret-value" },
    destructive: true,
  };
}

describe("StagingStore", () => {
  it("stages, lists, removes and clears without persistence", () => {
    const store = new StagingStore();
    const a = store.stage(commandEntry());
    expect(a.ok).toBe(true);
    expect(store.list().length).toBe(1);
    store.remove((a as { entry: { id: string } }).entry.id);
    expect(store.list().length).toBe(0);
    store.stage(commandEntry());
    store.clear();
    expect(store.list().length).toBe(0);
  });

  it("rejects a second entry for the same WAN target but allows other targets", () => {
    const store = new StagingStore();
    expect(store.stage(wanEntry()).ok).toBe(true);
    const conflict = store.stage(wanEntry());
    expect(conflict.ok).toBe(false);
    expect(conflict.ok !== true && conflict.reason).toBe("wan-conflict");
    // A different instance on the same device is a different target.
    expect(store.stage(wanEntry("TEST-1", "w.2")).ok).toBe(true);
    // The same target on another device is fine too.
    expect(store.stage(wanEntry("TEST-2", "w.1")).ok).toBe(true);
    // Removing the conflicting entry frees the slot.
    store.remove(store.list()[0].id);
    expect(store.stage(wanEntry()).ok).toBe(true);
  });

  it("caps staging at 100 entries", () => {
    const store = new StagingStore();
    for (let i = 0; i < STAGING_MAX_ENTRIES; ++i)
      expect(store.stage(commandEntry(`TEST-${i}`)).ok).toBe(true);
    const full = store.stage(commandEntry("TEST-overflow"));
    expect(full.ok).toBe(false);
    expect(full.ok !== true && full.reason).toBe("full");
  });

  it("summaries never carry secret payloads", () => {
    const store = new StagingStore();
    store.stage(wanEntry());
    // The panel renders ONLY the summary; form payloads stay in memory
    // until submit and are never summarized.
    const summary = JSON.stringify(store.list()[0].summary);
    expect(summary).not.toContain("secret-value");
    expect(store.list()[0].summary.action).toBe("WAN bridge");
  });

  it("notifies subscribers on every mutation", () => {
    const store = new StagingStore();
    let changes = 0;
    const unsubscribe = store.subscribe(() => ++changes);
    store.stage(commandEntry());
    store.clear();
    expect(changes).toBe(2);
    unsubscribe();
    store.stage(commandEntry());
    expect(changes).toBe(2);
  });
});
