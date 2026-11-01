# Referensi patch alur WAN dan tes UI

Snapshot dokumenter dari folder referensi, 1 November2026. Source berikut belum
dipasang pada fork. Ini bukti/rujukan migrasi, bukan instruksi menjalankan tes
terhadap deployment referensi. Password pada fixture adalah dummy test.
Pertahankan notices/lisensi GenieACS; renderer Mithril diganti React, aturan
perangkat dan hasil operasi dipertahankan sesuai feature-parity.md.

## ui/wan-editor.ts

SHA256 berkas asli:
`9feb128350f280a5b0647e84dc5cc956a3311b42e8dfc2c7ee075d04b5f6a894`.

```ts
import { ClosureComponent } from "mithril";
import { m } from "../components.ts";
import * as store from "../store.ts";
import * as taskQueue from "../task-queue.ts";
import * as notifications from "../notifications.ts";
import { stringify } from "../../lib/common/expression/parser.ts";
import { getWanEditorRequest } from "../wan-editor-state.ts";
import {
  activeManagementWan,
  buildWanTask,
  collections,
  connectionModes,
  connections,
  isZteWan,
  readSettings,
  requiredBridgeService,
  value,
  WanDevice,
  WanSettings,
  WanTask,
} from "../wan-model.ts";

interface Attrs {
  device: WanDevice;
  instance?: string;
  collection?: string;
  onclose?: () => void;
}
const component: ClosureComponent<Attrs> = () => {
  let selected = "",
    deviceId = "",
    fixedTarget = "",
    opened = false;
  let settings: WanSettings;
  let message = "",
    failed = false,
    busy = false,
    added = false,
    reloadAfterRead = false;
  let previousDevice: WanDevice;
  let lastRequest = 0,
    focusField = "";
  function load(device: WanDevice, target: string): void {
    selected = target;
    settings = readSettings(device, target.replace(/^new:/, ""));
    if (target.startsWith("new:"))
      Object.assign(settings, { enable: true, vlanEnable: true, vlan: "" });
    message = "";
    failed = false;
    added = false;
  }
  async function submitTask(task, success: string): Promise<boolean> {
    let ok = false;
    await taskQueue.commit([task], (id, error, connectionStatus, tasks) => {
      if (error) message = error.message;
      else if (connectionStatus !== "OK") message = connectionStatus;
      else if (tasks.some((item) => item.status === "fault"))
        message =
          "Modem menolak pengaturan. Lihat Device Faults untuk detail parameter.";
      else if (tasks.some((item) => item.status !== "done"))
        message =
          "Task menunggu Inform modem. Periksa koneksi dan Device Faults sebelum mengirim ulang.";
      else {
        message = success;
        ok = true;
      }
      failed = !ok;
    });
    store.setTimestamp(Date.now());
    return ok;
  }
  return {
    view: (vnode) => {
      const device = vnode.attrs.device;
      const available = collections(device).filter((path) =>
        isZteWan(device, path),
      );
      if (!/ZTE/i.test(String(value(device, "DeviceID.Manufacturer") || "")))
        return null;
      const id = String(value(device, "DeviceID.ID"));
      const target =
        vnode.attrs.instance ||
        (vnode.attrs.collection ? `new:${vnode.attrs.collection}` : "");
      if (deviceId !== id || target !== fixedTarget) {
        deviceId = id;
        fixedTarget = target;
        opened = !!target;
        load(
          device,
          target ||
            connections(device)[0] ||
            (available[0] ? `new:${available[0]}` : ""),
        );
      }
      if (!settings) load(device, target || connections(device)[0] || "");
      const request = getWanEditorRequest();
      if (
        !target &&
        request?.deviceId === id &&
        request.serial !== lastRequest
      ) {
        lastRequest = request.serial;
        opened = true;
        focusField = request.focus;
        load(device, request.path);
      }
      if (reloadAfterRead && device !== previousDevice) {
        settings = readSettings(device, selected.replace(/^new:/, ""));
        reloadAfterRead = false;
      }
      previousDevice = device;
      const isNew = selected.startsWith("new:");
      const collection = isNew
        ? selected.slice(4)
        : selected.replace(/\.\d+$/, "");
      const isPpp = collection.endsWith("WANPPPConnection");
      const bridge = /bridge/i.test(settings.mode);
      const bridgeService = requiredBridgeService(
        device,
        isNew ? collection : selected,
        settings.mode,
      );
      if (bridgeService) settings.service = bridgeService;
      const modes = connectionModes(device, isNew ? collection : selected);
      const canWrite = window.authorizer.hasAccess("devices", 3);
      const readWan = async (): Promise<void> => {
        busy = true;
        message = "Membaca parameter WAN…";
        failed = false;
        try {
          const ok = await submitTask(
            {
              name: "refreshObject",
              device: id,
              objectName:
                selected.replace(/^new:/, "") ||
                "InternetGatewayDevice.WANDevice",
              expiry: 300,
            },
            "Parameter WAN diperbarui. Buka kembali WAN yang akan diatur.",
          );
          if (ok) reloadAfterRead = true;
        } catch (error) {
          failed = true;
          message = error.message;
        } finally {
          busy = false;
          m.redraw();
        }
      };
      const apply = async (): Promise<void> => {
        try {
          if (!canWrite)
            throw new Error("Akun ini tidak memiliki izin mengubah perangkat.");
          const task = buildWanTask(
            device,
            collection,
            isNew ? null : selected,
            settings,
          );
          const conflicting = [...taskQueue.getQueue()].some(
            (item) =>
              item.device === id &&
              item.status !== "done" &&
              ((item.name === "setParameterValues" &&
                item.parameterValues?.some(
                  ([path]) => !isNew && path.startsWith(`${selected}.`),
                )) ||
                (item.name === "addObject" && item.objectName === collection)),
          );
          if (conflicting)
            throw new Error(
              "Masih ada task WAN ini di antrean. Selesaikan atau hapus task tersebut sebelum memakai form WAN.",
            );
          busy = true;
          failed = false;
          message = "Mengirim seluruh pengaturan WAN…";
          // A corrected complete request supersedes failed partial writes for this WAN only.
          if (!isNew && window.authorizer.hasAccess("faults", 3)) {
            // Use an awaited HTTP query, not a potentially stale store snapshot.
            const existing = await store.xhrRequest({
              method: "GET",
              url: `api/faults/?${m.buildQueryString({ filter: stringify(["LIKE", ["PARAM", "_id"], `${id}:task_%`]) })}`,
            });
            const virtualBelongsHere =
              isPpp &&
              (connections(device).filter((path) =>
                path.includes("WANPPPConnection"),
              ).length === 1 ||
                (value(device, "VirtualParameters.pppoeUsername") &&
                  value(device, "VirtualParameters.pppoeUsername") ===
                    value(device, `${selected}.Username`)));
            const virtualPaths = virtualBelongsHere
              ? [
                  "VirtualParameters.pppoeUsername",
                  "VirtualParameters.pppoePassword",
                ]
              : [];
            for (const fault of existing as Record<string, unknown>[]) {
              if (fault["code"] !== "cwmp.9003") continue;
              let commands;
              try {
                commands = JSON.parse(String(fault["provisions"]));
              } catch {
                continue;
              }
              if (
                Array.isArray(commands) &&
                commands.length &&
                commands.every(
                  (command) =>
                    Array.isArray(command) &&
                    command[0] === "value" &&
                    typeof command[1] === "string" &&
                    (command[1].startsWith(`${selected}.`) ||
                      virtualPaths.includes(command[1])),
                )
              ) {
                await store.deleteResource("faults", String(fault["_id"]));
              }
            }
          }
          if (
            await submitTask(
              task,
              "Pengaturan WAN diterima modem. Klik Baca WAN untuk melihat status koneksinya.",
            )
          ) {
            settings.password = "";
            added = isNew;
            const mode = task.parameterValues.find(
              ([path]) => path === `${selected}.ConnectionType`,
            )?.[1];
            const binding = task.parameterValues.find(
              ([path]) => path === `${selected}.X_ZTE-COM_LanInterface`,
            );
            if (
              !isNew &&
              /_Bridged$/i.test(String(mode)) &&
              mode !== value(device, `${selected}.ConnectionType`) &&
              binding
            ) {
              // A route-to-bridge change can clear a previously equal binding.
              // Read the new state first so GenieACS does not skip that write.
              message = "Menyelesaikan binding LAN/WiFi…";
              const refreshed = await submitTask(
                {
                  name: "refreshObject",
                  device: id,
                  objectName: selected,
                  expiry: 300,
                },
                "Binding LAN/WiFi dibaca ulang.",
              );
              if (
                !refreshed ||
                !(await submitTask(
                  {
                    name: "setParameterValues",
                    device: id,
                    parameterValues: [binding],
                    expiry: 300,
                  },
                  "Pengaturan WAN dan binding LAN/WiFi diterapkan. Klik Baca WAN untuk melihat statusnya.",
                ))
              ) {
                message = `Pengaturan WAN diterima; binding LAN/WiFi belum selesai. ${message}`;
                return;
              }
            }
            notifications.push("success", `${id}: Pengaturan WAN diterapkan`);
          }
        } catch (error) {
          failed = true;
          message = error.message;
        } finally {
          busy = false;
          m.redraw();
        }
      };
      const text = (
        key: keyof WanSettings,
        label: string,
        options: Record<string, unknown> = {},
      ) =>
        m("label.wan-field", [
          m("span", label),
          m("input", {
            name: key,
            value: settings[key],
            autocomplete: key === "password" ? "new-password" : "off",
            ...options,
            oninput: (event) => {
              settings[key] = event.target.value as never;
              if (
                key === "vlan" &&
                /^\d+$/.test(event.target.value) &&
                +event.target.value > 0
              )
                settings.vlanEnable = true;
            },
          }),
        ]);
      const select = (
        key: keyof WanSettings,
        label: string,
        choices: [string, string][],
      ) =>
        m("label.wan-field", [
          m("span", label),
          m(
            "select",
            {
              name: key,
              value: settings[key],
              onchange: (event) => {
                settings[key] = event.target.value as never;
                if (key === "mode" && /Bridged$/i.test(String(settings.mode))) {
                  settings.nat = false;
                  if (/TR069|VoIP/i.test(settings.service))
                    settings.service = "OTHER";
                }
              },
            },
            choices.map(([val, caption]) =>
              m("option", { value: val }, caption),
            ),
          ),
        ]);
      const checkbox = (
        key: keyof WanSettings,
        label: string,
        disabled = false,
      ) =>
        m("label.wan-check", [
          m("input", {
            type: "checkbox",
            name: key,
            checked: !!settings[key],
            disabled,
            onchange: (event) => {
              settings[key] = event.target.checked as never;
            },
          }),
          label,
        ]);
      const services = bridgeService
        ? [bridgeService]
        : [
            ...new Set([
              settings.service,
              "INTERNET",
              "OTHER",
              "TR069",
              "INTERNET_TR069",
              "VoIP_TR069",
              "INTERNET_VoIP_TR069",
            ]),
          ].filter((service) => !bridge || !/TR069/i.test(service));
      const bindingOptions = Object.keys(device).filter((path) =>
        /^InternetGatewayDevice\.LANDevice\.\d+\.(LANEthernetInterfaceConfig|WLANConfiguration)\.\d+$/.test(
          path,
        ),
      );
      const options = connections(device).map((path) =>
        m(
          "option",
          { value: path },
          `${path.includes("WANPPPConnection") ? "PPP" : "IP"} ${path.split(".").pop()} — ${value(device, `${path}.Name`) || "Belum dikonfigurasi"} — VLAN ${value(device, `${path}.X_ZTE-COM_VLANID`) ?? "?"}`,
        ),
      );
      for (const parent of available)
        if (device[parent]?.writable === true)
          options.push(
            m(
              "option",
              { value: `new:${parent}` },
              `Tambah ${parent.endsWith("WANPPPConnection") ? "PPPoE" : "WAN IP"} — ${parent.match(/WANConnectionDevice\.(\d+)/)?.[1]}`,
            ),
          );
      return m(
        "section.wan-editor",
        {
          onupdate: (node) => {
            if (!focusField || !opened) return;
            const input = node.dom.querySelector(`[name="${focusField}"]`) as
              | HTMLInputElement
              | HTMLSelectElement;
            if (input) {
              node.dom.scrollIntoView({ block: "start", behavior: "smooth" });
              input.focus();
              focusField = "";
            }
          },
        },
        [
          m("div.wan-heading", [
            m("h2", "Provisioning WAN ZTE"),
            m(
              "button",
              {
                type: "button",
                onclick: () => {
                  opened = !opened;
                },
              },
              opened ? "Tutup form" : "Atur WAN",
            ),
          ]),
          !opened
            ? m(
                "p",
                "Atur WAN IP, PPPoE, VLAN dan bridge dalam satu pengiriman.",
              )
            : [
                m(
                  "p.wan-help",
                  "Pilih WAN dan lengkapi pengaturannya. Semua perubahan dikirim bersama saat Anda menekan Terapkan WAN.",
                ),
                m("fieldset", { disabled: busy || !canWrite }, [
                  !target
                    ? m("label.wan-field.wan-target", [
                        m("span", "Koneksi WAN"),
                        m(
                          "select",
                          {
                            name: "target",
                            value: selected,
                            onchange: (event) =>
                              load(device, event.target.value),
                          },
                          options,
                        ),
                      ])
                    : m("p.wan-path", selected),
                  !isNew
                    ? m(
                        "p.wan-help",
                        `Status: ${value(device, `${selected}.ConnectionStatus`) || "belum dibaca"} · IP: ${value(device, `${selected}.ExternalIPAddress`) || "belum dibaca"}`,
                      )
                    : null,
                  !available.length
                    ? m(
                        "p",
                        "Parameter WAN belum dibaca. Gunakan Baca WAN terlebih dahulu.",
                      )
                    : [
                        !isNew && activeManagementWan(device, selected)
                          ? m(
                              "p.wan-warning",
                              "WAN ini adalah jalur ACS aktif. Mode bridge, menonaktifkan WAN, atau menghapus layanan TR069 memerlukan jalur manajemen lain terlebih dahulu.",
                            )
                          : null,
                        m("div.wan-grid", [
                          text("name", "Conn Name", { maxlength: 64 }),
                          select(
                            "mode",
                            "Conn Mode",
                            modes.map((mode) => [
                              mode,
                              `${/_Bridged$/i.test(mode) ? "Bridge" : "Route"} (${mode})`,
                            ]),
                          ),
                          select(
                            "service",
                            "Service List",
                            services.map((service) => [service, service]),
                          ),
                          text("vlan", "VLAN ID", {
                            type: "number",
                            inputmode: "numeric",
                            step: 1,
                            min: settings.vlanEnable ? 1 : 0,
                            max: 4094,
                            placeholder: "1–4094",
                          }),
                          text("priority", "Prioritas VLAN", {
                            type: "number",
                            min: 0,
                            max: 7,
                          }),
                          ...(isPpp && !bridge
                            ? [
                                text("username", "Username PPPoE"),
                                text(
                                  "password",
                                  isNew ||
                                    !value(device, `${selected}.Username`)
                                    ? "Password PPPoE"
                                    : "Password PPPoE (kosong = tetap)",
                                  { type: "password" },
                                ),
                              ]
                            : []),
                          ...(!isPpp && !bridge
                            ? [
                                select("addressingType", "DHCP / Static", [
                                  ["DHCP", "DHCP"],
                                  ["Static", "Static"],
                                ]),
                                ...(settings.addressingType === "Static"
                                  ? [
                                      text("ip", "IP Address"),
                                      text("gateway", "Gateway"),
                                      text("mask", "Subnet Mask"),
                                      text("dns", "DNS (pisahkan dengan koma)"),
                                    ]
                                  : []),
                              ]
                            : []),
                        ]),
                        m(
                          "p.wan-help",
                          "Mengisi VLAN ID mengaktifkan VLAN. Matikan Enable VLAN untuk koneksi tanpa VLAN.",
                        ),
                        bridgeService
                          ? m(
                              "p.wan-help",
                              "Firmware F670 ini memerlukan Service List INTERNET untuk mode bridge.",
                            )
                          : null,
                        m("div.wan-switches", [
                          checkbox("enable", "Enable WAN"),
                          checkbox("vlanEnable", "Enable VLAN"),
                          checkbox("nat", "NAT", bridge),
                        ]),
                        m("fieldset.wan-bindings", [
                          m("legend", "LAN / WiFi Bind"),
                          ...bindingOptions.map((path) =>
                            m("label.wan-check", [
                              m("input", {
                                type: "checkbox",
                                name: `bind:${path}`,
                                checked: settings.lanBind
                                  .split(",")
                                  .includes(path),
                                onchange: (event) => {
                                  const chosen = new Set(
                                    settings.lanBind.split(",").filter(Boolean),
                                  );
                                  if (event.target.checked) chosen.add(path);
                                  else chosen.delete(path);
                                  settings.lanBind = [...chosen].join(",");
                                },
                              }),
                              `${path.includes("WLANConfiguration") ? "WiFi" : "LAN"} ${path.split(".").pop()}`,
                            ]),
                          ),
                          text(
                            "lanBind",
                            "Lan Bind (path interface, dipisahkan koma)",
                          ),
                        ]),
                        modes.length === 1
                          ? m(
                              "p.wan-help",
                              "Pilihan mode mengikuti data modem. Klik Baca WAN jika mode bridge belum tersedia.",
                            )
                          : null,
                      ],
                  m("div.wan-buttons", [
                    m(
                      "button.primary",
                      {
                        type: "button",
                        name: "applyWan",
                        disabled: !selected || added || !canWrite,
                        onclick: apply,
                      },
                      busy ? "Memproses…" : "Terapkan WAN",
                    ),
                    m(
                      "button",
                      { type: "button", name: "readWan", onclick: readWan },
                      "Baca WAN",
                    ),
                    vnode.attrs.onclose
                      ? m(
                          "button",
                          { type: "button", onclick: vnode.attrs.onclose },
                          "Tutup",
                        )
                      : null,
                  ]),
                ]),
                !canWrite
                  ? m(
                      "p.wan-warning",
                      "Akun ini tidak memiliki izin mengubah perangkat.",
                    )
                  : null,
                message
                  ? m(
                      "p.wan-result",
                      { role: "status", class: failed ? "error" : "" },
                      message,
                    )
                  : null,
              ],
        ],
      );
    },
  };
};
export default component;
```

## tests/wan-ui.test.cjs

SHA256 berkas asli:
`02756664ccaec58af3b8faaa679196e0f1bc94d043833deb1ee410d6cc8f60b1`.

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Vnode = require("/opt/genieacs/node_modules/mithril/render/vnode");
const root = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1";
const ppp = `${root}.WANPPPConnection.2`,
  ip = `${root}.WANIPConnection.1`;
global.window = { authorizer: { hasAccess: () => true } };
const ui = require("/tmp/wan-ui-components.cjs");
function setup() {
  const d = {
    "DeviceID.ID": { value: ["TEST-F670-TEST", "xsd:string"] },
    "DeviceID.Manufacturer": { value: ["ZTE", "xsd:string"] },
    [`${root}.WANPPPConnection`]: { writable: true },
    [`${root}.WANIPConnection`]: { writable: true },
  };
  for (const base of [ip, ppp]) {
    d[base] = { writable: true };
    for (const [key, val, type] of [
      ["Name", "INTERNET", "xsd:string"],
      ["Enable", false, "xsd:boolean"],
      ["ConnectionType", "IP_Routed", "xsd:string"],
      ["PossibleConnectionTypes", "IP_Routed,PPPoE_Bridged", "xsd:string"],
      ["X_ZTE-COM_ServiceList", "INTERNET", "xsd:string"],
      ["X_ZTE-COM_VLANEnable", 1, "xsd:unsignedInt"],
      ["X_ZTE-COM_VLANID", 1000, "xsd:unsignedInt"],
      ["X_ZTE-COM_8021P", 0, "xsd:unsignedInt"],
      ["NATEnabled", true, "xsd:boolean"],
      ["Username", "", "xsd:string"],
      ["Password", "", "xsd:string"],
      ["AddressingType", "DHCP", "xsd:string"],
      ["X_ZTE-COM_LanInterface", "", "xsd:string"],
    ])
      d[`${base}.${key}`] = { value: [val, type], writable: true };
  }
  global.__wanEnv = {
    device: d,
    queue: new Set(),
    queued: [],
    commits: [],
    requests: [],
    deleted: [],
    faults: [],
  };
  window.authorizer.hasAccess = () => true;
  return d;
}
function nodes(v, out = []) {
  if (Array.isArray(v)) for (const x of v) nodes(x, out);
  else if (v && typeof v === "object") {
    out.push(v);
    nodes(v.children, out);
  }
  return out;
}
function field(v, name) {
  const n = nodes(v).find((x) => x.attrs?.name === name);
  assert.ok(n, `Field ${name} missing`);
  return n;
}
function text(v) {
  return JSON.stringify(v, (k, x) => (typeof x === "function" ? undefined : x));
}
function mount(d, attrs = { instance: ppp }) {
  const c = ui.editor();
  const vnode = { attrs: { device: d, ...attrs }, state: {} };
  return { c, vnode, view: () => c.view(vnode) };
}
test("full form sends one complete typed request and clears the password", async () => {
  const d = setup(),
    s = mount(d);
  let view = s.view();
  field(view, "username").attrs.oninput({ target: { value: "test-account" } });
  field(view, "password").attrs.oninput({
    target: { value: "test-private-password" },
  });
  field(view, "enable").attrs.onchange({ target: { checked: true } });
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 1);
  assert.equal(__wanEnv.commits[0].length, 1);
  const task = __wanEnv.commits[0][0],
    values = Object.fromEntries(task.parameterValues.map(([p, v]) => [p, v]));
  assert.equal(values[`${ppp}.Enable`], true);
  assert.equal(values[`${ppp}.X_ZTE-COM_VLANID`], 1000);
  assert.equal(values[`${ppp}.Password`], "test-private-password");
  assert.equal(field(s.view(), "password").attrs.value, "");
  assert.match(text(s.view()), /diterima/);
});
test("invalid input never enqueues a request or deletes faults", async () => {
  const d = setup(),
    s = mount(d);
  field(s.view(), "vlan").attrs.oninput({ target: { value: "9000" } });
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 0);
  assert.equal(__wanEnv.requests.length, 0);
  assert.equal(__wanEnv.deleted.length, 0);
  assert.match(text(s.view()), /VLAN ID/);
});
test("a first PPPoE connection accepts a typed VLAN and sends tagged AddObject values", async () => {
  const d = setup(),
    collection = `${root}.WANPPPConnection`;
  for (const key of Object.keys(d))
    if (key.startsWith(collection + ".")) delete d[key];
  const s = mount(d, { collection });
  assert.notEqual(field(s.view(), "vlan").attrs.disabled, true);
  assert.equal(field(s.view(), "vlan").attrs.value, "");
  field(s.view(), "vlan").attrs.oninput({ target: { value: "1000" } });
  assert.equal(field(s.view(), "vlan").attrs.value, "1000");
  assert.equal(field(s.view(), "vlanEnable").attrs.checked, true);
  field(s.view(), "username").attrs.oninput({
    target: { value: "test-new-account" },
  });
  field(s.view(), "password").attrs.oninput({
    target: { value: "test-new-password" },
  });
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 1);
  const task = __wanEnv.commits[0][0],
    values = Object.fromEntries(task.parameterValues.map(([p, v]) => [p, v]));
  assert.equal(task.name, "addObject");
  assert.equal(task.objectName, collection);
  assert.equal(values["X_ZTE-COM_VLANID"], 1000);
  assert.equal(values["X_ZTE-COM_VLANEnable"], 1);
});
test("editing VLAN enables tagging while an explicit untagged choice remains respected", async () => {
  const d = setup();
  d[`${ppp}.X_ZTE-COM_VLANEnable`].value[0] = 0;
  d[`${ppp}.X_ZTE-COM_VLANID`].value[0] = 0;
  d[`${ppp}.Username`].value[0] = "existing-account";
  const s = mount(d);
  assert.notEqual(field(s.view(), "vlan").attrs.disabled, true);
  field(s.view(), "vlan").attrs.oninput({ target: { value: "21" } });
  assert.equal(field(s.view(), "vlanEnable").attrs.checked, true);
  field(s.view(), "vlanEnable").attrs.onchange({ target: { checked: false } });
  await field(s.view(), "applyWan").attrs.onclick();
  const values = Object.fromEntries(
    __wanEnv.commits[0][0].parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ppp}.X_ZTE-COM_VLANID`], 0);
  assert.equal(values[`${ppp}.X_ZTE-COM_VLANEnable`], 0);
});
test("new PPPoE requires a VLAN or an explicit untagged choice", async () => {
  const d = setup(),
    s = mount(d, { collection: `${root}.WANPPPConnection` });
  field(s.view(), "username").attrs.oninput({
    target: { value: "test-new-account" },
  });
  field(s.view(), "password").attrs.oninput({
    target: { value: "test-new-password" },
  });
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 0);
  assert.match(text(s.view()), /VLAN ID/);
  field(s.view(), "vlanEnable").attrs.onchange({ target: { checked: false } });
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 1);
  assert.equal(
    __wanEnv.commits[0][0].parameterValues.find(
      ([p]) => p === "X_ZTE-COM_VLANEnable",
    )[1],
    0,
  );
});
test("bridge editor uses advertised mode and submits NAT/service/binding together", async () => {
  const d = setup();
  d[`${ip}.X_ZTE-COM_ServiceList`].value[0] = "VoIP_TR069";
  const s = mount(d, { instance: ip });
  field(s.view(), "mode").attrs.onchange({
    target: { value: "PPPoE_Bridged" },
  });
  field(s.view(), "enable").attrs.onchange({ target: { checked: true } });
  field(s.view(), "lanBind").attrs.oninput({
    target: {
      value: "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1",
    },
  });
  await field(s.view(), "applyWan").attrs.onclick();
  const values = Object.fromEntries(
    __wanEnv.commits[0][0].parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "PPPoE_Bridged");
  assert.equal(values[`${ip}.NATEnabled`], false);
  assert.equal(values[`${ip}.X_ZTE-COM_ServiceList`], "OTHER");
  assert.ok(values[`${ip}.X_ZTE-COM_LanInterface`]);
});

test("bridge conversion refreshes and reapplies an existing SSID binding after the mode change", async () => {
  const d = setup(),
    binding = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2";
  d["DeviceID.ProductClass"] = { value: ["F670", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V6.0.10P3N19", "xsd:string"],
  };
  d[`${ip}.X_ZTE-COM_LanInterface`].value[0] = binding;
  const s = mount(d, { instance: ip });
  assert.ok(text(s.view()).includes("IP_Bridged"));
  field(s.view(), "mode").attrs.onchange({ target: { value: "IP_Bridged" } });
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 3);
  assert.equal(__wanEnv.commits[0][0].name, "setParameterValues");
  assert.deepEqual(__wanEnv.commits[1][0], {
    name: "refreshObject",
    device: "TEST-F670-TEST",
    objectName: ip,
    expiry: 300,
  });
  assert.deepEqual(__wanEnv.commits[2][0].parameterValues, [
    [`${ip}.X_ZTE-COM_LanInterface`, binding, "xsd:string"],
  ]);
  assert.match(text(s.view()), /binding LAN\/WiFi diterapkan/);
});

test("does not reapply a bridge binding if its refresh failed", async () => {
  const d = setup(),
    s = mount(d, { instance: ip });
  field(s.view(), "mode").attrs.onchange({
    target: { value: "PPPoE_Bridged" },
  });
  field(s.view(), "lanBind").attrs.oninput({
    target: { value: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2" },
  });
  __wanEnv.results = ["done", "fault"];
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 2);
  assert.match(text(s.view()), /binding LAN\/WiFi belum selesai/);
});
test("F670 bridge form displays and submits INTERNET instead of rejected OTHER service", async () => {
  const d = setup();
  d["DeviceID.ProductClass"] = { value: ["F670", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V6.0.10P3N19", "xsd:string"],
  };
  d[`${ip}.X_ZTE-COM_ServiceList`].value[0] = "OTHER";
  d[`${ip}.X_ZTE-COM_LanInterface`].value[0] =
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2";
  const s = mount(d, { instance: ip });
  field(s.view(), "mode").attrs.onchange({ target: { value: "IP_Bridged" } });
  const service = field(s.view(), "service");
  assert.equal(service.attrs.value, "INTERNET");
  assert.deepEqual(
    nodes(service)
      .filter((n) => n.tag === "option")
      .map((n) => n.attrs.value),
    ["INTERNET"],
  );
  await field(s.view(), "applyWan").attrs.onclick();
  const values = Object.fromEntries(
    __wanEnv.commits[0][0].parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "IP_Bridged");
  assert.equal(values[`${ip}.X_ZTE-COM_ServiceList`], "INTERNET");
  assert.equal(values[`${ip}.NATEnabled`], false);
});
test("P3N3 form and legacy popup select the verified WAN IP bridge mode", async () => {
  const d = setup();
  d["DeviceID.ProductClass"] = { value: ["F670", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V6.0.10P3N3", "xsd:string"],
  };
  d[`${ip}.Name`].value[0] = "other";
  d[`${ip}.X_ZTE-COM_LanInterface`].value[0] =
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1";
  const s = mount(d, { instance: ip });
  assert.deepEqual(
    nodes(field(s.view(), "mode"))
      .filter((n) => n.tag === "option")
      .map((n) => n.attrs.value),
    ["IP_Routed", "IP_Bridged"],
  );
  field(s.view(), "mode").attrs.onchange({ target: { value: "IP_Bridged" } });
  field(s.view(), "vlan").attrs.oninput({ target: { value: "20" } });
  field(s.view(), "enable").attrs.onchange({ target: { checked: true } });
  await field(s.view(), "applyWan").attrs.onclick();
  const values = Object.fromEntries(
    __wanEnv.commits[0][0].parameterValues.map(([p, v]) => [p, v]),
  );
  assert.equal(values[`${ip}.ConnectionType`], "IP_Bridged");
  assert.equal(values[`${ip}.X_ZTE-COM_VLANID`], 20);
  assert.equal(values[`${ip}.NATEnabled`], false);
  assert.equal(__wanEnv.commits.length, 3);
  const task = {
      name: "setParameterValues",
      devices: ["TEST-F670-TEST"],
      parameterValues: [[`${ip}.ConnectionType`, "bridge", "xsd:string"]],
    },
    invalid = new WeakSet();
  ui.renderWanStaging(
    task,
    () => {},
    () => {},
    invalid,
  );
  assert.equal(task.parameterValues[0][1], "IP_Bridged");
  assert.equal(invalid.has(task), false);
});
test("F609 new WAN IP form submits bridge VLAN1100 bound to SSID2", async () => {
  const d = setup(),
    collection = `${root}.WANIPConnection`;
  d["DeviceID.ProductClass"] = { value: ["F609", "xsd:string"] };
  d["InternetGatewayDevice.DeviceInfo.SoftwareVersion"] = {
    value: ["V5.2.10P5T13", "xsd:string"],
  };
  const s = mount(d, { collection });
  assert.deepEqual(
    nodes(field(s.view(), "mode"))
      .filter((n) => n.tag === "option")
      .map((n) => n.attrs.value),
    ["IP_Routed", "IP_Bridged"],
  );
  field(s.view(), "name").attrs.oninput({ target: { value: "other" } });
  field(s.view(), "mode").attrs.onchange({ target: { value: "IP_Bridged" } });
  field(s.view(), "vlan").attrs.oninput({ target: { value: "1100" } });
  field(s.view(), "lanBind").attrs.oninput({
    target: { value: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2" },
  });
  await field(s.view(), "applyWan").attrs.onclick();
  const task = __wanEnv.commits[0][0],
    values = Object.fromEntries(task.parameterValues.map(([p, v]) => [p, v]));
  assert.equal(task.name, "addObject");
  assert.equal(task.objectName, collection);
  assert.equal(values.ConnectionType, "IP_Bridged");
  assert.equal(values["X_ZTE-COM_VLANID"], 1100);
  assert.equal(
    values["X_ZTE-COM_LanInterface"],
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  );
  assert.equal(values.Enable, true);
  assert.equal(values.NATEnabled, false);
});
test("only superseded partial faults for the selected WAN are removed", async () => {
  const d = setup();
  d[`${ppp}.Username`].value[0] = "existing";
  __wanEnv.faults = [
    {
      _id: "same:old",
      code: "cwmp.9003",
      provisions: JSON.stringify([["value", `${ppp}.Enable`, true]]),
    },
    {
      _id: "same:other-wan",
      code: "cwmp.9003",
      provisions: JSON.stringify([["value", `${ip}.Name`, "other"]]),
    },
  ];
  const s = mount(d);
  await field(s.view(), "applyWan").attrs.onclick();
  assert.deepEqual(__wanEnv.deleted, ["same:old"]);
  assert.match(__wanEnv.requests[0].url, /filter=/);
  assert.ok(decodeURIComponent(__wanEnv.requests[0].url).includes("LIKE"));
});
test("an account without write access cannot submit even by calling the handler", async () => {
  const d = setup();
  window.authorizer.hasAccess = () => false;
  const s = mount(d);
  await field(s.view(), "applyWan").attrs.onclick();
  assert.equal(__wanEnv.commits.length, 0);
});
test("a fault is not presented as success", async () => {
  const d = setup();
  d[`${ppp}.Username`].value[0] = "existing";
  __wanEnv.result = "fault";
  const s = mount(d);
  await field(s.view(), "applyWan").attrs.onclick();
  assert.match(text(s.view()), /menolak/);
});
test("WAN table cells open the batch editor rather than queueing a single value", () => {
  const d = setup(),
    c = ui.table(),
    vnode = {
      attrs: {
        device: d,
        parameter: ["PARAM", `${root}.WANIPConnection`],
        label: "WAN IP",
        childParameters: {
          0: { label: "Conn Mode", parameter: ["PARAM", "ConnectionType"] },
        },
        deviceQuery: {},
      },
      state: {},
    };
  c.oninit(vnode);
  let view = c.view(vnode);
  const edit = nodes(view).find(
    (n) => n.tag === "button" && n.attrs?.className === "wan-value",
  );
  assert.ok(edit);
  edit.attrs.onclick();
  view = c.view(vnode);
  assert.ok(
    nodes(view).some((n) => n.tag === "wan-editor" && n.attrs.instance === ip),
  );
  assert.equal(__wanEnv.queued.length, 0);
});
test("Atur WAN table button renders the editor through Mithril child normalization", () => {
  const d = setup(),
    c = ui.table(),
    vnode = {
      attrs: {
        device: d,
        parameter: ["PARAM", `${root}.WANIPConnection`],
        label: "WAN IP",
        childParameters: {
          0: { label: "Conn Mode", parameter: ["PARAM", "ConnectionType"] },
        },
        deviceQuery: {},
      },
      state: {},
    };
  c.oninit(vnode);
  const view = c.view(vnode);
  const button = nodes(view).find(
    (n) => n.tag === "button" && text(n.children).includes("Atur WAN"),
  );
  assert.ok(button);
  button.attrs.onclick();
  const opened = c.view(vnode);
  assert.doesNotThrow(() => Vnode.normalizeChildren(opened));
  const editor = nodes(opened).find(
    (n) => n.tag === "wan-editor" && n.attrs.instance === ip,
  );
  assert.ok(editor);
  const form = ui.editor();
  field(form.view({ attrs: editor.attrs }), "applyWan");
  editor.attrs.onclose();
  const closed = c.view(vnode);
  assert.doesNotThrow(() => Vnode.normalizeChildren(closed));
  assert.ok(!nodes(closed).some((n) => n.tag === "wan-editor"));
  assert.equal(__wanEnv.queued.length, 0);
  assert.equal(__wanEnv.commits.length, 0);
});
test("Tambah WAN table button opens a new connection form without fragment errors", () => {
  const d = setup(),
    c = ui.table(),
    vnode = {
      attrs: {
        device: d,
        parameter: ["PARAM", `${root}.WANPPPConnection`],
        label: "WAN PPP",
        childParameters: {
          0: { label: "Conn Name", parameter: ["PARAM", "Name"] },
        },
        deviceQuery: {},
      },
      state: {},
    };
  c.oninit(vnode);
  const view = c.view(vnode);
  const button = nodes(view).find(
    (n) => n.tag === "button" && text(n.children).includes("Tambah WAN"),
  );
  assert.ok(button);
  button.attrs.onclick();
  const opened = c.view(vnode);
  assert.doesNotThrow(() => Vnode.normalizeChildren(opened));
  const editor = nodes(opened).find((n) => n.tag === "wan-editor");
  assert.equal(editor.attrs.collection, `${root}.WANPPPConnection`);
  const form = ui.editor(),
    rendered = form.view({ attrs: editor.attrs });
  field(rendered, "username");
  field(rendered, "password");
  field(rendered, "applyWan");
  assert.equal(__wanEnv.commits.length, 0);
});
test("the device page Atur WAN button opens and closes without remounting", () => {
  const d = setup(),
    s = mount(d, {});
  let view = s.view();
  assert.ok(!nodes(view).some((n) => n.attrs?.name === "applyWan"));
  const toggle = () =>
    nodes(s.view())
      .find(
        (n) =>
          n.tag === "button" && /Atur WAN|Tutup form/.test(text(n.children)),
      )
      .attrs.onclick();
  toggle();
  view = s.view();
  field(view, "applyWan");
  field(view, "target");
  assert.doesNotThrow(() => Vnode.normalizeChildren([view]));
  toggle();
  assert.ok(!nodes(s.view()).some((n) => n.attrs?.name === "applyWan"));
});
test("the legacy mode popup normalizes bridge using modem capabilities", () => {
  setup();
  const task = {
    name: "setParameterValues",
    devices: ["TEST-F670-TEST"],
    parameterValues: [[`${ip}.ConnectionType`, "bridge", "xsd:string"]],
  };
  const invalid = new WeakSet();
  ui.renderWanStaging(
    task,
    () => {},
    () => {},
    invalid,
  );
  assert.equal(task.parameterValues[0][1], "PPPoE_Bridged");
  assert.equal(invalid.has(task), false);
});
test("task drawer summaries do not expose passwords", () => {
  setup();
  __wanEnv.queue.add({
    name: "setParameterValues",
    device: "TEST-F670-TEST",
    status: "queued",
    parameterValues: [[`${ppp}.Password`, "private-test-value", "xsd:string"]],
  });
  const c = ui.drawer();
  const rendered = c.view({ attrs: {}, state: {} });
  assert.ok(!text(rendered).includes("private-test-value"));
});
test("overview PPP credentials open the WAN editor instead of a partial task", () => {
  const d = setup();
  d["VirtualParameters.pppoeUsername"] = {
    value: ["account", "xsd:string"],
    writable: true,
  };
  d[`${ppp}.Username`].value[0] = "account";
  const c = ui.parameter();
  const vnode = {
    attrs: {
      device: d,
      parameter: ["PARAM", "VirtualParameters.pppoeUsername"],
    },
    state: {},
  };
  const rendered = c.view(vnode);
  const button = nodes(rendered).find((n) => n.tag === "button");
  assert.ok(button);
  button.attrs.onclick();
  assert.equal(__wanEnv.queued.length, 0);
  const editor = mount(d, {});
  const view = editor.view();
  assert.ok(nodes(view).some((n) => n.attrs?.name === "username"));
  assert.equal(field(view, "target").attrs.value, ppp);
});
test("associated virtual PPP credential faults are superseded by the full form", async () => {
  const d = setup();
  d[`${ppp}.Username`].value[0] = "account";
  __wanEnv.faults = [
    {
      _id: "old-virtual",
      code: "cwmp.9003",
      provisions: JSON.stringify([
        ["value", "VirtualParameters.pppoePassword", "old-private"],
      ]),
    },
  ];
  const s = mount(d);
  await field(s.view(), "applyWan").attrs.onclick();
  assert.deepEqual(__wanEnv.deleted, ["old-virtual"]);
});
```
