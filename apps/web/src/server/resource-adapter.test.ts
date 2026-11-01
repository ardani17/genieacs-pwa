import { expect, test } from "vitest";
import { normalizeListQuery } from "./resource-adapter";
import { escapeCsvCell, maskDeviceForUi } from "./mask-device";

test("pagination is bounded and sort is stable", () => {
  expect(
    normalizeListQuery(
      { page: "2", pageSize: "25", sort: '{"DeviceID.SerialNumber":1}' },
      "devices",
    ),
  ).toMatchObject({
    skip: 25,
    limit: 25,
    sort: { "DeviceID.SerialNumber": 1, "DeviceID.ID": 1 },
  });
  expect(() => normalizeListQuery({ pageSize: "10000" }, "devices")).toThrow(
    "VALIDATION",
  );
});

test("query guards: sizes, page, sort shape, length caps", () => {
  expect(() => normalizeListQuery({ pageSize: "10" }, "devices")).toThrow(
    "VALIDATION",
  );
  expect(() => normalizeListQuery({ page: "0" }, "devices")).toThrow(
    "VALIDATION",
  );
  expect(() => normalizeListQuery({ page: "1.5" }, "devices")).toThrow(
    "VALIDATION",
  );
  expect(() => normalizeListQuery({ sort: '{"a":2}' }, "devices")).toThrow(
    "VALIDATION",
  );
  expect(() => normalizeListQuery({ sort: "not-json" }, "devices")).toThrow(
    "VALIDATION",
  );
  expect(() =>
    normalizeListQuery({ filter: "x".repeat(8193) }, "devices"),
  ).toThrow("VALIDATION");
  // 9 sort fields rejected; tiebreaker appended otherwise.
  expect(() =>
    normalizeListQuery(
      {
        sort: JSON.stringify(
          Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, 1])),
        ),
      },
      "devices",
    ),
  ).toThrow("VALIDATION");
  const n = normalizeListQuery({}, "tasks");
  expect(n.sort).toEqual({ _id: 1 });
  expect(n.skip).toBe(0);
  expect(n.limit).toBe(25);
});

test("device masking hides secret parameter values, keeps the rest", () => {
  const masked = maskDeviceForUi({
    "DeviceID.ID": { value: ["dev-1", "xsd:string"] },
    "Device.WiFi.SSID.1.PreSharedKey": { value: ["wpa-secret", "xsd:string"] },
    "Device.ManagementServer.Password": { value: ["pw", "xsd:string"] },
    "Device.Wan.IP": { value: ["10.0.0.1", "xsd:string"] },
  });
  expect(JSON.stringify(masked)).not.toContain("wpa-secret");
  expect(JSON.stringify(masked)).not.toContain('"pw"');
  expect(
    (masked["Device.WiFi.SSID.1.PreSharedKey"] as { value: unknown })
      .value as string,
  ).toBe("[REDACTED]");
  expect((masked["Device.Wan.IP"] as { value: string[] }).value[0]).toBe(
    "10.0.0.1",
  );
});

test("csv cells neutralize formula injection and quotes", () => {
  expect(escapeCsvCell("=SUM(A1)")).toBe('"\'=SUM(A1)"');
  expect(escapeCsvCell('a"b')).toBe('"a""b"');
  expect(escapeCsvCell("plain")).toBe('"plain"');
});
