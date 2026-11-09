"use client";

// User management (M06-C): roles and passwords through the engine's
// dedicated admin endpoints — hashing happens SERVER-side; password
// hashes/salts are never returned, listed or exported. Deleting the
// last admin-role user is refused with a recovery hint.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiResult } from "@contracts/api.ts";

interface UserRow {
  _id: string;
  roles: string;
}

async function call<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "X-App-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      // Non-2xx responses still carry the typed envelope; anything
      // unparseable degrades to the same offline result as a throw.
      const errBody = (await res
        .json()
        .catch(() => null)) as ApiResult<T> | null;
      return errBody && typeof errBody === "object" && "ok" in errBody
        ? errBody
        : {
            ok: false,
            error: {
              code: "RESULT_UNKNOWN",
              message: "Koneksi terputus",
              retryable: false,
            },
            requestId: "unknown",
          };
    }
    return (await res.json()) as ApiResult<T>;
  } catch {
    return {
      ok: false,
      error: {
        code: "RESULT_UNKNOWN",
        message: "Koneksi terputus",
        retryable: false,
      },
      requestId: "unknown",
    };
  }
}

export function UserManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rolesList, setRolesList] = useState<string[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoles, setNewRoles] = useState("");
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    const [usersRes, permsRes] = await Promise.all([
      fetch("/api/app/resources/users?page=1&pageSize=100", {
        cache: "no-store",
      }),
      fetch("/api/app/resources/permissions?page=1&pageSize=100", {
        cache: "no-store",
      }),
    ]);
    if (usersRes.status === 403 || permsRes.status === 403) {
      setState("forbidden");
      return;
    }
    const usersBody = (await usersRes.json()) as ApiResult<{
      items: Record<string, unknown>[];
    }>;
    const permsBody = (await permsRes.json()) as ApiResult<{
      items: Record<string, unknown>[];
    }>;
    if (usersBody.ok !== true || permsBody.ok !== true) {
      setState("error");
      return;
    }
    // users:3 readers never see password/salt (projection drops them).
    setUsers(
      usersBody.data.items.map((u) => ({
        _id: String(u["_id"]),
        roles: String(u["roles"] ?? ""),
      })),
    );
    setRolesList(
      [...new Set(permsBody.data.items.map((p) => String(p["role"])))].sort(),
    );
    setState("ready");
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const createUser = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await call("/api/app/admin/users", "POST", {
        username: newName,
        password: newPassword,
        roles: newRoles,
      });
      if (result.ok !== true) setError(result.error.message);
      else {
        setCreating(false);
        setNewName("");
        setNewPassword("");
        setNewRoles("");
        await load();
      }
      setNewPassword("");
    } finally {
      setBusy(false);
    }
  };

  const resetPwd = async (): Promise<void> => {
    if (!resetTarget) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call(
        `/api/app/admin/users/${encodeURIComponent(resetTarget)}/password`,
        "PUT",
        { newPassword: resetPassword },
      );
      if (result.ok !== true) setError(result.error.message);
      else setResetTarget(null);
      setResetPassword("");
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (): Promise<void> => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call<{ locked?: boolean }>(
        `/api/app/resources/users/${encodeURIComponent(deleteTarget)}`,
        "DELETE",
      );
      if (result.ok !== true) setError(result.error.message);
      else {
        setDeleteTarget(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (state === "forbidden")
    return (
      <Status tone="warning">
        Anda tidak memiliki izin mengelola pengguna.
      </Status>
    );
  if (state === "error")
    return <Status tone="danger">Pengguna tidak dapat dimuat.</Status>;

  return (
    <div className="space-y-4">
      {error ? <Status tone="warning">{error}</Status> : null}
      <Card>
        <CardContent className="space-y-2">
          <ul className="divide-y">
            {users.map((u) => (
              <li
                key={u._id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{u._id}</p>
                  <p className="text-xs text-muted-foreground">{u.roles}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setResetTarget(u._id);
                      setResetPassword("");
                    }}
                  >
                    Reset password
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget(u._id)}
                  >
                    Hapus
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            Tambah pengguna
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) setCreating(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pengguna baru</DialogTitle>
            <DialogDescription>
              Password di-hash di server; hash/salt tidak pernah kembali ke
              browser.
            </DialogDescription>
          </DialogHeader>
          <Field label="Nama pengguna" required>
            {({ id }) => (
              <Input
                id={id}
                value={newName}
                autoComplete="off"
                onChange={(e) => setNewName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Password (min 8)" required>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            )}
          </Field>
          <Field label="Role (pisah koma)" required>
            {({ id }) => (
              <Input
                id={id}
                value={newRoles}
                placeholder={rolesList.join(", ")}
                onChange={(e) => setNewRoles(e.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button
              onClick={() => void createUser()}
              busy={busy}
              disabled={
                !newName.trim() || newPassword.length < 8 || !newRoles.trim()
              }
            >
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password {resetTarget}</DialogTitle>
            <DialogDescription>
              Sesi pengguna lain tidak berubah; sesi target tetap berlaku hingga
              token kedaluwarsa (maksimum 8 jam).
            </DialogDescription>
          </DialogHeader>
          <Field label="Password baru (min 8)" required>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                value={resetPassword}
                autoComplete="new-password"
                onChange={(e) => setResetPassword(e.target.value)}
              />
            )}
          </Field>
          <DialogFooter>
            <Button
              onClick={() => void resetPwd()}
              busy={busy}
              disabled={resetPassword.length < 8}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sesi aktif pengguna ini berakhir dalam ≤10 detik (snapshot
              permission refresh). Menonaktifkan admin terakhir ditolak server —
              pemulihan memakai runbook reset admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <Status tone="warning">{error}</Status> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void removeUser();
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
