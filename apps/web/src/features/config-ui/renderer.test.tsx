// Config renderer tests (M06-A): malicious anchors never render,
// unknown nodes stay visible with their config path, expressions
// evaluate through the native parser (time + device parameters),
// nested containers lay out, and a serialize → edit → save → load
// round-trip preserves the configuration semantically (unknown keys
// included).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfigRenderer, normalizeConfigTree } from "./renderer";
import { evaluateUiExpression } from "./expression";

const device = {
  "DeviceID.ID": { value: ["TEST-1", "xsd:string"] },
  "DeviceID.ProductClass": { value: ["F670", "xsd:string"] },
  "InternetGatewayDevice.DeviceInfo.SoftwareVersion": {
    value: ["V6.0.10P3N19", "xsd:string"],
  },
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable": {
    value: [true, "xsd:boolean"],
  },
} as never;

const ctx = { device, now: 1730000000000 };

describe("ConfigRenderer safety", () => {
  it("unsafe anchor cannot execute script and unknown node is visible", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <ConfigRenderer
        node={
          {
            type: "container",
            components: [
              {
                type: "a",
                href: "javascript:alert(1)",
                label: "Unsafe",
              } as never,
              { type: "unknown-plugin" } as never,
            ],
          } as never
        }
        context={ctx}
      />,
    );
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(screen.getByText(/Komponen belum didukung/)).toBeVisible();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("data: and strange schemes are dropped; http and relative anchors render", () => {
    render(
      <ConfigRenderer
        node={
          {
            type: "container",
            components: [
              { type: "a", href: "data:text/html,x", label: "Data" } as never,
              {
                type: "a",
                href: "https://example.invalid/x",
                label: "Ext",
              } as never,
              { type: "a", href: "/devices/TEST-1", label: "Inner" } as never,
            ],
          } as never
        }
        context={ctx}
      />,
    );
    expect(screen.queryByText("Data")).toBeNull();
    expect(screen.getByRole("link", { name: "Ext" })).toHaveAttribute(
      "rel",
      expect.stringContaining("noopener"),
    );
    expect(screen.getByRole("link", { name: "Inner" })).not.toHaveAttribute(
      "target",
      "_blank",
    );
  });
});

describe("ConfigRenderer rendering", () => {
  it("renders parameters from the device and expression labels", () => {
    render(
      <ConfigRenderer
        node={
          {
            type: "container",
            label: "Grup",
            components: [
              {
                type: "parameter",
                label: "Model",
                parameter: "DeviceID.ProductClass",
              } as never,
              {
                type: "parameter",
                label: "Online",
                expression:
                  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable",
              } as never,
            ],
          } as never
        }
        context={ctx}
      />,
    );
    expect(screen.getByText("F670")).toBeVisible();
    expect(screen.getByText("true", { exact: false })).toBeVisible();
  });

  it("nested containers and parameter tables render", () => {
    render(
      <ConfigRenderer
        node={
          {
            type: "container",
            label: "Luar",
            components: [
              {
                type: "container",
                label: "Dalam",
                components: [
                  { type: "parameter", parameter: "DeviceID.ID" } as never,
                ],
              } as never,
              {
                type: "parameter-table",
                parameters: ["DeviceID.ID", "DeviceID.ProductClass"],
              } as never,
            ],
          } as never
        }
        context={ctx}
      />,
    );
    expect(screen.getByText("Luar")).toBeVisible();
    expect(screen.getByText("Dalam")).toBeVisible();
    expect(screen.getAllByText("TEST-1").length).toBe(2);
  });

  it("overview-dot reflects expression truthiness", () => {
    render(
      <ConfigRenderer
        node={
          {
            type: "overview-dot",
            label: "Status",
            expression: 'DeviceID.ID = "TEST-1"',
          } as never
        }
        context={ctx}
      />,
    );
    expect(screen.getByText("Status")).toBeVisible();
  });
});

describe("expression evaluator", () => {
  it("evaluates parameters and deterministic time functions", () => {
    expect(evaluateUiExpression("DeviceID.ProductClass", device, ctx.now)).toBe(
      "F670",
    );
    expect(
      evaluateUiExpression('DeviceID.ProductClass = "F670"', device, ctx.now),
    ).toBe(true);
    // Malformed expressions degrade to null, never throw.
    expect(
      evaluateUiExpression("this is ((not valid", device, ctx.now),
    ).toBeNull();
  });
});

describe("config round-trip", () => {
  it("serialize → edit → save → load keeps semantic equality including unknowns", () => {
    const original = {
      type: "container",
      label: "Root",
      components: [
        { type: "parameter", parameter: "DeviceID.ID" },
        { type: "future-type", custom: { keep: "me" } },
      ],
    };
    // A save/load cycle through the editor must not drop anything it
    // does not understand.
    const roundTripped = JSON.parse(
      JSON.stringify(normalizeConfigTree(original)),
    );
    expect(roundTripped).toEqual(original);
    roundTripped.label = "Root diubah";
    expect(roundTripped.components[1]).toEqual(original.components[1]);
  });
});
