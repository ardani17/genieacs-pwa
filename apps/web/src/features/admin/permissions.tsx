"use client";

// Permission editor (M06-C): native permission documents (role,
// resource, access, filter, validate) — including the vpn/logs
// resources — through the BFF resource routes. The SERVER re-checks
// every mutation; changing a permission takes effect on live sessions
// within the snapshot window.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiResult } from "@contracts/api.ts";

const RESOURCES = [
  "devices",
  "presets",
  "provisions",
  "virtualParameters",
  "files",
  "config",
  "permissions",
  "users",
  "faults",
  "tasks",
  "vpn",
  "logs",
];

interface PermRow {
  _id: string;
  role: string;
  resource: string;
  access: number;
  filter?: string;
  validate?: string;
}

export function PermissionManager() {
  const [rows, setRows] = useState<PermRow[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState("");
  const [resource, setResource] = useState("devices");
  const [access, setAccess] = useState("1");
  const [validate, setValidate] = useState("true");
  const [filter, setFilter] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    const res = await fetch(
      "/api/app/resources/permissions?page=1&pageSize=100",
      { cache: "no-store" },
    );
    if (res.status === 403) {
      setState("forbidden");
      return;
    }
    const body = (await res.json()) as ApiResult<{
      items: Record<string, unknown>[];
    }>;
    if (body.ok !== true) {
      setState("error");
      return;
    }
    setRows(
      body.data.items.map((p) => ({
        _id: String(p["_id"]),
        role: String(p["role"]),
        resource: String(p["resource"]),
        access: Number(p["access"]),
        filter: p["filter"] == null ? undefined : String(p["filter"]),
        validate: p["validate"] == null ? undefined : String(p["validate"]),
      })),
    );
    setState("ready");
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const add = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const id = `${role}:${resource}:${access}`;
      const doc: Record<string, unknown> = {
        _id: id,
        role,
        resource,
        access: Number(access),
        validate: validate || undefined,
        filter: filter || undefined,
      };
      const res = await fetch(
        `/api/app/resources/permissions/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-App-Request": "1" },
          body: JSON.stringify(doc),
          cache: "no-store",
        },
      );
      if (!res.ok) setError("Permission tidak dapat disimpan.");
      else {
        setAdding(false);
        setRole("");
        setFilter("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/app/resources/permissions/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { "X-App-Request": "1" },
          cache: "no-store",
        },
      );
      if (!res.ok) setError("Permission tidak dapat dihapus.");
      else await load();
    } finally {
      setBusy(false);
    }
  };

  if (state === "forbidden")
    return (
      <Status tone="warning">
        Anda tidak memiliki izin mengelola permission.
      </Status>
    );
  if (state === "error")
    return <Status tone="danger">Permission tidak dapat dimuat.</Status>;

  return (
    <div className="space-y-4">
      {error ? <Status tone="warning">{error}</Status> : null}
      <Card>
        <CardContent className="space-y-2">
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm" aria-label="Daftar permission">
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id} className="border-b last:border-b-0">
                    <td className="p-2 font-mono text-xs">{row.role}</td>
                    <td className="p-2 text-xs">{row.resource}</td>
                    <td className="p-2 text-center font-mono text-xs">
                      {row.access}
                    </td>
                    <td className="max-w-56 break-all p-2 font-mono text-xs text-muted-foreground">
                      {row.filter ?? "—"}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(row._id)}
                      >
                        Hapus
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            Tambah permission
          </Button>
        </CardContent>
      </Card>
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          if (!open) setAdding(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permission baru</DialogTitle>
          </DialogHeader>
          <Field label="Role" required>
            {({ id }) => (
              <Input
                id={id}
                value={role}
                autoComplete="off"
                onChange={(e) => setRole(e.target.value)}
              />
            )}
          </Field>
          <Field label="Resource" required>
            {({ id }) => (
              <Select value={resource} onValueChange={setResource}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Akses" required>
            {({ id }) => (
              <Select value={access} onValueChange={setAccess}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 — ada</SelectItem>
                  <SelectItem value="2">2 — baca</SelectItem>
                  <SelectItem value="3">3 — tulis</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field label="Validator (ekspresi)">
            {({ id }) => (
              <Input
                id={id}
                value={validate}
                onChange={(e) => setValidate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Filter (ekspresi)">
            {({ id }) => (
              <Input
                id={id}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button
              onClick={() => void add()}
              busy={busy}
              disabled={!role.trim()}
            >
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
