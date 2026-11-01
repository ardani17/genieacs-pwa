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
