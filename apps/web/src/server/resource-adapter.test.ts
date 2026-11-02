import { expect, test } from "vitest";
import { normalizeListQuery, deviceFilterWithSearch } from "./resource-adapter";
import { escapeCsvCell, maskDeviceForUi, maskDeviceCsv } from "./mask-device";

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

test("deviceFilterWithSearch combines search and filter through the native AST", () => {
  // Search alone: LIKE clauses over identity fields; quotes in the
  // needle stay literal (escaped), no wildcard injection.
  const searchOnly = deviceFilterWithSearch('ONT-"prod"', null);
  expect(searchOnly).toContain("DeviceID.ID");
  expect(searchOnly).toContain("prod");
  expect(searchOnly).not.toMatch(/LIKE "%ONT-"%/);

  // Filter alone passes through validated by the native parser.
  const filterOnly = deviceFilterWithSearch(null, '_tags = "online"');
  expect(filterOnly).toBe('_tags = "online"');

  // Both are ANDed and round-trip parseable.
  const combined = deviceFilterWithSearch("ZTE", '_tags = "online"');
  expect(combined).toContain("AND");
  expect(combined).toContain('_tags = "online"');
  expect(combined).toContain("ZTE");

  // Invalid filter expressions are rejected HERE, not upstream.
  expect(() => deviceFilterWithSearch("x", "this is not (valid")).toThrow(
    "VALIDATION",
  );
  // Over-length input is bounded.
  expect(() => deviceFilterWithSearch("x", "a".repeat(8193))).toThrow(
    "VALIDATION",
  );

  expect(deviceFilterWithSearch(null, null)).toBeNull();
  expect(deviceFilterWithSearch("   ", null)).toBeNull();
});

test("maskDeviceCsv redacts secret parameter values row by row", () => {
  const csv = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
    '"Device.WiFi.KeyPassphrase",0,1,1,1,"super-secret-key","xsd:string",1,0,0,0,1',
    '"Device.Wan.IP",0,1,1,1,"10.0.0.1, backup","xsd:string",1,0,0,0,1',
  ].join("\n");
  const masked = maskDeviceCsv(csv);
  expect(masked).not.toContain("super-secret-key");
  expect(masked).toContain('"[REDACTED]"');
  // Quoted commas survive intact on non-secret rows.
  expect(masked).toContain('"10.0.0.1, backup"');
});

test("maskDeviceCsv masks MULTILINE quoted secret values (RE-STD-04)", () => {
  // Reviewer repro: 6-column CSV whose secret Value spans two physical
  // lines — the continuation line used to escape masking entirely.
  const csv = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value",
    '"Device.WiFi.KeyPassphrase",0,1,1,1,"line1\nSYNTHETIC_MULTILINE_SECRET"',
  ].join("\n");
  expect(maskDeviceCsv(csv)).toBe(
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value\n" +
      '"Device.WiFi.KeyPassphrase",0,1,1,1,"[REDACTED]"',
  );
});

test("maskDeviceCsv treats CRLF separators and CRLF inside quoted values", () => {
  // Engine dialect: unquoted Parameter path; the quoted value itself
  // contains a CRLF. Record separators are CRLF too.
  const csv = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value",
    'Device.WiFi.KeyPassphrase,0,1,1,1,"p1\r\nSECRET_CRLF"',
  ].join("\r\n");
  expect(maskDeviceCsv(csv)).toBe(
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value\n" +
      'Device.WiFi.KeyPassphrase,0,1,1,1,"[REDACTED]"',
  );
});

test("maskDeviceCsv handles the engine dialect: only Value quoted, commas in Access list", () => {
  const csv = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
    'Device.WiFi.KeyPassphrase,0,1,1,1,"super-secret-key","xsd:string",1,0,0,"Obj, Sub",1',
    'Device.Wan.IP,0,1,1,1,"10.0.0.1, backup","xsd:string",1,0,0,"Obj, Sub",1',
  ].join("\n");
  const masked = maskDeviceCsv(csv);
  expect(masked).not.toContain("super-secret-key");
  const lines = masked.split("\n");
  // Only the Value cell is rewritten; every other byte is preserved.
  expect(lines[1]).toBe(
    'Device.WiFi.KeyPassphrase,0,1,1,1,"[REDACTED]","xsd:string",1,0,0,"Obj, Sub",1',
  );
  // Non-secret rows are byte-identical (comma-in-quotes in Value and
  // the unquoted Access list join survive).
  expect(lines[2]).toBe(csv.split("\n")[2]);
});

test("maskDeviceCsv keeps escaped quotes on non-secret rows, redacts them on secret rows", () => {
  const csv = [
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value,Value type,Value timestamp,Notification,Notification timestamp,Access list,Access list timestamp",
    '"Device.Wan.IP",0,1,1,1,"a""b","xsd:string",1,0,0,0,1',
    '"Device.WiFi.KeyPassphrase",0,1,1,1,"pw""d","xsd:string",1,0,0,0,1',
  ].join("\n");
  const masked = maskDeviceCsv(csv);
  const lines = masked.split("\n");
  expect(lines[1]).toBe(csv.split("\n")[1]);
  expect(lines[2]).toBe(
    '"Device.WiFi.KeyPassphrase",0,1,1,1,"[REDACTED]","xsd:string",1,0,0,0,1',
  );
  expect(masked).not.toContain('pw""d');
});

test("maskDeviceCsv preserves the trailing newline and leaves short records alone", () => {
  expect(
    maskDeviceCsv(
      "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value\n",
    ),
  ).toBe(
    "Parameter,Object,Object timestamp,Writable,Writable timestamp,Value\n",
  );
  expect(maskDeviceCsv('Short,record\n"still here",1\n')).toBe(
    'Short,record\n"still here",1\n',
  );
  // Multiline secret at end-of-input (no closing record after it).
  expect(
    maskDeviceCsv('Device.WiFi.PreSharedKey,0,1,1,1,"x\nSECRET_TAIL"\n'),
  ).toBe('Device.WiFi.PreSharedKey,0,1,1,1,"[REDACTED]"\n');
});
