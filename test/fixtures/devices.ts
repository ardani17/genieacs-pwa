// SAFE device fixtures: TEST- prefixed IDs, example.invalid hosts,
// 192.0.2.0/24 (TEST-NET-1) addresses and dummy credentials only. No
// real customer data or copied credentials ever appear here.
import type { Device } from "../../lib/db/types.ts";

export function makeZte(options: {
  model: "F609" | "F670" | "F660";
  firmware: string;
  id: string;
}): Device {
  return {
    _id: options.id,
    _lastInform: new Date(),
    _registered: new Date(),
    DeviceID: {
      ID: {
        _value: options.id,
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
      Manufacturer: {
        _value: "ZTE",
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
      ProductClass: {
        _value: options.model,
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
      SerialNumber: {
        _value: `TEST-SN-${options.id}`,
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
    },
    InternetGatewayDevice: {
      DeviceInfo: {
        SoftwareVersion: {
          _value: options.firmware,
          _type: "xsd:string",
          _object: false,
          _timestamp: 1,
        },
      },
      WANDevice: {
        "1": {
          WANConnectionDevice: {
            "1": {
              WANPPPConnection: {
                "1": {
                  Username: {
                    _value: "test-user@example.invalid",
                    _type: "xsd:string",
                    _object: false,
                    _timestamp: 1,
                  },
                  ConnectionType: {
                    _value: "PPPoE_Bridged",
                    _type: "xsd:string",
                    _object: false,
                    _timestamp: 1,
                  },
                },
              },
              WANIPConnection: {
                "1": {
                  ExternalIPAddress: {
                    _value: `192.0.2.${(parseInt(options.id.replace(/\D/g, "") || "1", 10) % 254) + 1}`,
                    _type: "xsd:string",
                    _object: false,
                    _timestamp: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
  } as unknown as Device;
}

export function makeGeneric(options: {
  manufacturer: string;
  model: string;
  id: string;
}): Device {
  return {
    _id: options.id,
    _lastInform: new Date(),
    _registered: new Date(),
    DeviceID: {
      ID: {
        _value: options.id,
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
      Manufacturer: {
        _value: options.manufacturer,
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
      ProductClass: {
        _value: options.model,
        _type: "xsd:string",
        _object: false,
        _timestamp: 1,
      },
    },
    Device: {
      DeviceInfo: {
        SoftwareVersion: {
          _value: "generic-1.0",
          _type: "xsd:string",
          _object: false,
          _timestamp: 1,
        },
      },
    },
  } as unknown as Device;
}

// Flat (query-shaped) ZTE WAN fixture mirroring the frozen reference
// fixture in docs/design/reference-wan-model.md: both a WAN IP and a
// WAN PPP instance under the first connection device, every parameter
// writable except PossibleConnectionTypes. Dummy credentials only.
import type { WanDevice } from "../../packages/device-profiles/src/wan-types.ts";

export const WAN_ROOT =
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1";
export const WAN_IP = `${WAN_ROOT}.WANIPConnection`;
export const WAN_IP_INSTANCE = `${WAN_IP}.1`;
export const WAN_PPP = `${WAN_ROOT}.WANPPPConnection`;
export const WAN_PPP_INSTANCE = `${WAN_PPP}.2`;

export function makeZteWan(options: {
  model?: string;
  firmware?: string | null;
  id?: string;
}): WanDevice {
  const d: WanDevice = {
    "DeviceID.ID": { value: [options.id ?? "TEST-F670-TEST", "xsd:string"] },
    "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
    [WAN_IP]: { writable: true },
    [WAN_PPP]: { writable: true },
  };
  if (options.model)
    d["DeviceID.ProductClass"] = { value: [options.model, "xsd:string"] };
  if (options.firmware)
    d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
      value: [options.firmware, "xsd:string"],
    };
  for (const base of [WAN_IP_INSTANCE, WAN_PPP_INSTANCE]) {
    d[base] = { writable: true };
    for (const [name, value, type] of [
      ["Name", "", "xsd:string"],
      ["Enable", false, "xsd:boolean"],
      ["ConnectionType", "IP_Routed", "xsd:string"],
      ["PossibleConnectionTypes", "IP_Routed,PPPoE_Bridged", "xsd:string"],
      ["ConnectionTrigger", "AlwaysOn", "xsd:string"],
      ["X_ZTE-COM_ServiceList", "", "xsd:string"],
      ["X_ZTE-COM_VLANEnable", 0, "xsd:unsignedInt"],
      ["X_ZTE-COM_VLANID", 0, "xsd:unsignedInt"],
      ["X_ZTE-COM_8021P", 0, "xsd:unsignedInt"],
      ["NATEnabled", true, "xsd:boolean"],
      ["Username", "", "xsd:string"],
      ["Password", "", "xsd:string"],
      ["AddressingType", "DHCP", "xsd:string"],
      ["ExternalIPAddress", "0.0.0.0", "xsd:string"],
      ["SubnetMask", "0.0.0.0", "xsd:string"],
      ["DefaultGateway", "0.0.0.0", "xsd:string"],
      ["DNSServers", "", "xsd:string"],
      ["X_ZTE-COM_LanInterface", "", "xsd:string"],
    ] as const)
      d[`${base}.${name}`] = {
        value: [value, type],
        writable: name !== "PossibleConnectionTypes",
      };
  }
  return d;
}

export const PROFILE_MATRIX = {
  verifiedZte: [
    makeZte({ model: "F609", firmware: "V5.2.10P5T13", id: "TEST-ZTE-F609" }),
    makeZte({ model: "F670", firmware: "V6.0.10P3N19", id: "TEST-ZTE-F670-1" }),
    makeZte({ model: "F670", firmware: "V6.0.10P3N3", id: "TEST-ZTE-F670-2" }),
    makeZte({ model: "F660", firmware: "V5.2.10P1T2", id: "TEST-ZTE-F660" }),
  ],
  unverifiedZteFirmware: [
    makeZte({ model: "F670", firmware: "unknown", id: "TEST-ZTE-UNKNOWN" }),
  ],
  genericVendors: [
    makeGeneric({
      manufacturer: "Huawei",
      model: "HG8245H",
      id: "TEST-HUAWEI",
    }),
    makeGeneric({
      manufacturer: "FiberHome",
      model: "HG6245D",
      id: "TEST-FIBERHOME",
    }),
    makeGeneric({
      manufacturer: "OtherVendor",
      model: "TR181",
      id: "TEST-TR181",
    }),
  ],
} as const;
