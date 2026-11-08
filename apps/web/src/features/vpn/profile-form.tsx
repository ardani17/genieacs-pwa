"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/components/session-provider";
import { hasResourceAccess } from "@/lib/permissions";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { VpnStatusPanel } from "./status-panel";
import {
  validateVpnProfileInput,
  type VpnProfileInput,
  type VpnProfileView,
} from "@contracts/settings";
import type { VpnStatus } from "@contracts/vpn";

const empty = (): VpnProfileInput => ({
  revision: 0,
  server: "",
  username: "",
  passwordAction: "replace",
  password: "",
  routes: [],
  mtu: 1400,
  acs: { mode: "auto-ppp", scheme: "http", host: null, port: 7547, path: "/" },
});
const fromView = (view: VpnProfileView): VpnProfileInput => ({
  revision: view.revision,
  server: view.server,
  username: view.username,
  passwordAction: view.passwordConfigured ? "keep" : "replace",
  routes: [...view.routes],
  mtu: view.mtu,
  acs: { ...view.acs },
});
type Saved = {
  view: VpnProfileView;
  desiredRevision: number;
  applyState: string;
  applyError?: string | null;
};

export function VpnSettings() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const { state } = useSession();
  const canRead =
    state.phase === "authenticated" &&
    hasResourceAccess(state.session, "vpn", 1);
  const canEdit =
    state.phase === "authenticated" &&
    hasResourceAccess(state.session, "vpn", 3);
  return (
    <div className="space-y-6">
      {canRead ? (
        <VpnStatusPanel canEdit={canEdit} onStatus={setStatus} />
      ) : (
        <p>Tidak ada izin melihat VPN.</p>
      )}
      {canEdit ? <VpnProfileForm status={status} /> : null}
    </div>
  );
}
export function VpnProfileForm({ status }: { status?: VpnStatus | null } = {}) {
  const [form, setForm] = useState(empty);
  const [saved, setSaved] = useState<VpnProfileView | null>(null);
  const [comparison, setComparison] = useState<VpnProfileView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"saved" | "error" | null>(
    null,
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [impact, setImpact] = useState(false);
  const [reset, setReset] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const load = async (compare = false) => {
    const result = await apiRequest<{ status: string; view?: VpnProfileView }>(
      "/api/app/settings",
    );
    if (result.ok === false) {
      setFeedbackKind("error");
      setMessage(`${result.error.message} · requestId ${result.requestId}`);
      return;
    }
    const view = result.data.view;
    if (compare) {
      setComparison(view ?? null);
      return;
    }
    setSaved(view ?? null);
    setForm(view ? fromView(view) : empty());
    setLoaded(true);
    setConflict(false);
    setComparison(null);
    setFields({});
    setMessage("");
    setFeedbackKind(null);
  };
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);
  const save = async (kind: "save" | "reset" = "save") => {
    setBusy(true);
    setImpact(false);
    try {
      const result = await apiRequest<Saved>(
        kind === "save" ? "/api/app/settings" : "/api/app/vpn/reset-bootstrap",
        {
          method: kind === "save" ? "PUT" : "POST",
          body: JSON.stringify(
            kind === "save"
              ? form
              : { revision: form.revision, confirm: confirmation },
          ),
        },
      );
      if (result.ok === false) {
        setFeedbackKind("error");
        setFields(result.error.fieldErrors ?? {});
        setConflict(result.error.code === "CONFLICT");
        setMessage(
          result.error.code === "CONFLICT"
            ? `Profil server berubah. Form lokal dipertahankan; bandingkan atau muat ulang. · requestId ${result.requestId}`
            : `${result.error.message} · requestId ${result.requestId}`,
        );
        return;
      }
      setSaved(result.data.view);
      setForm(fromView(result.data.view));
      setFields({});
      setConflict(false);
      setComparison(null);
      setReset(false);
      setConfirmation("");
      setFeedbackKind("saved");
      setMessage(
        result.data.applyState === "failed"
          ? `Profil tersimpan; koneksi gagal. Profil baru tetap dipertahankan. ${result.data.applyError ?? ""}`
          : `Profil tersimpan. Revision ${result.data.desiredRevision}; ${result.data.applyState === "applied" ? "terhubung" : "koneksi sedang diterapkan"}.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateVpnProfileInput(form);
    if (result.ok === false) {
      setFields(result.fieldErrors);
      return;
    }
    if (saved && JSON.stringify(saved.acs) !== JSON.stringify(form.acs)) {
      setImpact(true);
      return;
    }
    void save();
  };
  const textField = (label: string, key: "server" | "username") => (
    <Field label={label} error={fields[key]}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          autoComplete="off"
          required
        />
      )}
    </Field>
  );
  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="text-lg font-semibold">Profil VPN dan alamat ACS</h2>
        {message ? (
          <p role="status" className="break-words text-sm">
            {feedbackKind === "saved" &&
            saved &&
            saved.revision === status?.desiredRevision
              ? status.state === "connected" &&
                status.appliedRevision === saved.revision
                ? `Profil tersimpan. Revision ${saved.revision}; terhubung.`
                : [
                      "auth_failed",
                      "retry_wait",
                      "route_error",
                      "host_unsupported",
                    ].includes(status.state)
                  ? `Profil tersimpan; koneksi gagal. Profil baru tetap dipertahankan. ${status.lastErrorCode ?? ""}`
                  : message
              : message}
          </p>
        ) : null}
        {!loaded ? (
          <Button variant="outline" onClick={() => void load()}>
            Muat profil
          </Button>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm">
              Revision {form.revision}. Menyimpan profil dapat memutus koneksi
              VPN. Profil gagal tetap tersimpan sampai diperbaiki.
            </p>
            {textField("Server VPN", "server")}
            {textField("Username VPN", "username")}
            <Field label="Aksi password">
              {({ id }) => (
                <select
                  id={id}
                  className="min-h-11 w-full rounded-md border bg-background p-2"
                  value={form.passwordAction}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      passwordAction: e.target.value as "keep" | "replace",
                      password: undefined,
                    })
                  }
                >
                  <option value="keep" disabled={!saved?.passwordConfigured}>
                    Pertahankan password tersimpan
                  </option>
                  <option value="replace">Ganti password</option>
                </select>
              )}
            </Field>
            {form.passwordAction === "replace" ? (
              <Field label="Password VPN" error={fields.password}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    aria-describedby={describedBy}
                    value={form.password ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    required
                  />
                )}
              </Field>
            ) : (
              <p className="text-sm">
                Password tersimpan; nilainya tidak ditampilkan.
              </p>
            )}
            <Field
              label="Rute IPv4 (satu CIDR per baris)"
              error={Object.entries(fields)
                .filter(([key]) => key.startsWith("routes"))
                .map(([, value]) => value)
                .join("; ")}
            >
              {({ id, describedBy }) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  className="min-h-24 w-full rounded-md border bg-background p-2 text-sm"
                  value={form.routes.join("\n")}
                  onChange={(e) =>
                    setForm({ ...form, routes: e.target.value.split(/[,\n]/) })
                  }
                  onBlur={() =>
                    setForm({
                      ...form,
                      routes: form.routes.map((r) => r.trim()).filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
            <Field label="MTU" error={fields.mtu}>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={576}
                  max={1500}
                  value={form.mtu}
                  onChange={(e) =>
                    setForm({ ...form, mtu: Number(e.target.value) })
                  }
                />
              )}
            </Field>
            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 font-medium">Alamat ACS</legend>
              <Field label="Mode alamat ACS">
                {({ id }) => (
                  <select
                    id={id}
                    className="min-h-11 w-full rounded-md border bg-background p-2"
                    value={form.acs.mode}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        acs: {
                          ...form.acs,
                          mode: e.target.value as "manual" | "auto-ppp",
                          host: e.target.value === "manual" ? "" : null,
                        },
                      })
                    }
                  >
                    <option value="auto-ppp">Otomatis dari IP PPP</option>
                    <option value="manual">IP atau DNS manual</option>
                  </select>
                )}
              </Field>
              {form.acs.mode === "manual" ? (
                <Field label="Host ACS" error={fields["acs.host"]}>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={form.acs.host ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          acs: { ...form.acs, host: e.target.value },
                        })
                      }
                    />
                  )}
                </Field>
              ) : null}
              <Field label="Skema ACS">
                {({ id }) => (
                  <select
                    id={id}
                    className="min-h-11 w-full rounded-md border bg-background p-2"
                    value={form.acs.scheme}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        acs: {
                          ...form.acs,
                          scheme: e.target.value as "http" | "https",
                        },
                      })
                    }
                  >
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                )}
              </Field>
              <Field label="Port ACS" error={fields["acs.port"]}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={65535}
                    value={form.acs.port}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        acs: { ...form.acs, port: Number(e.target.value) },
                      })
                    }
                  />
                )}
              </Field>
              <Field label="Path ACS" error={fields["acs.path"]}>
                {({ id }) => (
                  <Input
                    id={id}
                    value={form.acs.path}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        acs: { ...form.acs, path: e.target.value },
                      })
                    }
                  />
                )}
              </Field>
              <p className="text-sm text-muted-foreground">
                Perubahan alamat ACS tidak menulis URL ke ONT. Reprovision dan
                sertifikat HTTPS dikelola terpisah.
              </p>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || conflict}>
                Simpan profil
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setReset(true)}
              >
                Reset ke deployment
              </Button>
            </div>
          </form>
        )}
        {conflict ? (
          <div className="space-y-3">
            <Button variant="outline" onClick={() => void load(true)}>
              Bandingkan dengan server
            </Button>
            <Button variant="outline" onClick={() => void load()}>
              Muat ulang profil
            </Button>
            {comparison ? (
              <pre className="max-w-full overflow-auto bg-muted p-3 text-xs">
                {JSON.stringify(comparison, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
        <Dialog open={impact} onOpenChange={setImpact}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Perubahan alamat ACS</DialogTitle>
              <DialogDescription>
                URL ONT tidak berubah otomatis. Pastikan perangkat dapat
                mencapai alamat baru dan sertifikatnya dipercaya.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setImpact(false)}>
                Batal
              </Button>
              <Button onClick={() => void save()}>Konfirmasi dan simpan</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={reset} onOpenChange={setReset}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset konfigurasi bootstrap</DialogTitle>
              <DialogDescription>
                Profil deployment akan menggantikan profil tersimpan pada
                revision {form.revision}. Tidak ada rollback otomatis.
              </DialogDescription>
            </DialogHeader>
            <Field label="Konfirmasi reset">
              {({ id }) => (
                <Input
                  id={id}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="Ketik RESET"
                />
              )}
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReset(false)}>
                Batal
              </Button>
              <Button
                disabled={busy || confirmation !== "RESET"}
                onClick={() => void save("reset")}
              >
                Reset profil
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
