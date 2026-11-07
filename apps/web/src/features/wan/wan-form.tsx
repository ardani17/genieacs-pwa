"use client";

// WAN form (M05-D): one editor shape for every entry point (Atur, add,
// table row, virtual PPP). Modes come from the device's advertised
// capability; bridge requires a LAN binding; a blank existing password
// keeps the device password (never sent); new PPP credentials are
// mandatory. The form never receives or shows stored secrets.
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WanSettings } from "../../../../../packages/device-profiles/src/wan-types.ts";

export function WanForm({
  settings,
  onChange,
  modes,
  isPpp,
  lanOptions,
  disabled,
}: {
  settings: WanSettings;
  onChange: (next: WanSettings) => void;
  modes: string[];
  isPpp: boolean;
  lanOptions: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const bridge = /_Bridged$/i.test(settings.mode);
  const set = (patch: Partial<WanSettings>) =>
    onChange({ ...settings, ...patch });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Nama koneksi" required>
        {({ id }) => (
          <Input
            id={id}
            value={settings.name}
            disabled={disabled}
            onChange={(e) => set({ name: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Conn Mode"
        required
        error={modes.length ? undefined : "Kemampuan perangkat belum terbaca"}
      >
        {({ id }) => (
          <Select
            value={settings.mode}
            onValueChange={(mode) => set({ mode })}
            disabled={disabled}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Pilih mode" />
            </SelectTrigger>
            <SelectContent>
              {modes.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Service List" required>
        {({ id }) => (
          <Input
            id={id}
            value={settings.service}
            disabled={disabled || bridge}
            onChange={(e) => set({ service: e.target.value })}
          />
        )}
      </Field>
      <Field label="VLAN ID (kosong = untagged)">
        {({ id }) => (
          <Input
            id={id}
            inputMode="numeric"
            value={settings.vlanEnable ? settings.vlan : ""}
            disabled={disabled || !settings.vlanEnable}
            onChange={(e) => set({ vlan: e.target.value })}
          />
        )}
      </Field>
      <Field label="Tagging VLAN">
        {({ id }) => (
          <Select
            value={settings.vlanEnable ? "tagged" : "untagged"}
            onValueChange={(v) =>
              set({
                vlanEnable: v === "tagged",
                vlan: v === "tagged" ? settings.vlan : "0",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="untagged">Untagged</SelectItem>
              <SelectItem value="tagged">Tagged</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="LAN bind (wajib untuk bridge aktif)">
        {({ id }) => (
          <Select
            value={settings.lanBind || "none"}
            onValueChange={(v) => set({ lanBind: v === "none" ? "" : v })}
            disabled={disabled}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Pilih interface" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— tidak dibinding —</SelectItem>
              {lanOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {isPpp && !bridge ? (
        <>
          <Field label="Username PPPoE" required>
            {({ id }) => (
              <Input
                id={id}
                value={settings.username}
                disabled={disabled}
                autoComplete="off"
                onChange={(e) => set({ username: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="Password PPPoE"
            required={false}
            error={
              !settings.password && !settings.username
                ? "Wajib untuk WAN PPP baru"
                : undefined
            }
          >
            {({ id }) => (
              <Input
                id={id}
                type="password"
                value={settings.password}
                disabled={disabled}
                autoComplete="new-password"
                onChange={(e) => set({ password: e.target.value })}
              />
            )}
          </Field>
        </>
      ) : null}
      {!isPpp && !bridge ? (
        <Field label="Addressing">
          {({ id }) => (
            <Select
              value={settings.addressingType}
              onValueChange={(addressingType) => set({ addressingType })}
              disabled={disabled}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DHCP">DHCP</SelectItem>
                <SelectItem value="Static">Static</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      ) : null}
      <Field label="Aktif">
        {({ id }) => (
          <Select
            value={settings.enable ? "on" : "off"}
            onValueChange={(v) => set({ enable: v === "on" })}
            disabled={disabled}
          >
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">Aktif</SelectItem>
              <SelectItem value="off">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
    </div>
  );
}
