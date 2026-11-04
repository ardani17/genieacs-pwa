// WAN model types ported verbatim from the frozen reference
// (docs/design/reference-wan-model.md, ui/wan-model.ts). Names, shapes
// and rules must stay identical — the reference is the migration proof.

export interface WanParameter {
  value?: [string | number | boolean, string];
  writable?: boolean;
}

export type WanDevice = Record<string, WanParameter>;

export interface WanSettings {
  name: string;
  mode: string;
  service: string;
  enable: boolean;
  nat: boolean;
  vlanEnable: boolean;
  vlan: string;
  priority: string;
  username: string;
  password: string;
  addressingType: string;
  ip: string;
  mask: string;
  gateway: string;
  dns: string;
  lanBind: string;
}

export type WanValue = [string, string | number | boolean, string];

export interface WanTask {
  name: "setParameterValues" | "addObject";
  device: string;
  parameterValues: WanValue[];
  objectName?: string;
  expiry: number;
  status?: string;
  _id?: string;
}
