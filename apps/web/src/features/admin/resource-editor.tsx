"use client";

// Generic admin resource editor (M06-B): list + create/edit/delete
// against the exact native resource shapes through the BFF resource
// routes (no second config DB). Unsaved changes guard navigation;
// saves re-fetch the resource and warn on concurrent modification
// (native has no atomic CAS — reload or explicit overwrite only).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
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
import { CodeEditor, type CodeLanguage } from "./code-editor";

export interface ResourceEditorConfig {
  resource: string;
  title: string;
  language: CodeLanguage;
  // Which document field holds the editable source; new documents are
  // created with this field empty.
  sourceField: string;
  blankDocument: () => Record<string, unknown>;
  // Optional storage transforms: presets (and similar structured
  // resources) edit a serialized view but PUT the native object.
  serialize?: (doc: Record<string, unknown>) => string;
  deserialize?: (
    source: string,
    draft: Record<string, unknown>,
  ) => Record<string, unknown>;
}

const CREDENTIAL_LOOKING = /password|secret|token|key|credential/i;

export function maskValue(id: string, value: string): string {
  if (CREDENTIAL_LOOKING.test(id)) return "••••••••";
  return value;
}

export function ResourceEditor({
  config,
  canRevealSecrets = false,
}: {
  config: ResourceEditorConfig;
  canRevealSecrets?: boolean;
}) {
  const { resource, language, sourceField } = config;
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "error" | "forbidden"
  >("loading");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const conflictRef = useRef<(() => void) | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    try {
      const res = await fetch(
        `/api/app/resources/${resource}?page=1&pageSize=100&projection=_id`,
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
      setItems(body.data.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [resource]);
  void config.title;

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  // Unsaved-changes guard for reload/close.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const fetchOne = async (
    id: string,
  ): Promise<Record<string, unknown> | null> => {
    const res = await fetch(
      `/api/app/resources/${resource}/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as ApiResult<Record<string, unknown>>;
    return body.ok ? body.data : null;
  };

  const open = async (id: string | null): Promise<void> => {
    setError(null);
    setRevealed(false);
    if (id == null) {
      const blank = config.blankDocument();
      setSelected(blank);
      setDraft(blank);
      setSource("");
      setDirty(false);
      return;
    }
    const doc = await fetchOne(id);
    if (!doc) {
      setError("Resource tidak dapat dibaca.");
      return;
    }
    setSelected(doc);
    setDraft(doc);
    setSource(
      config.serialize ? config.serialize(doc) : String(doc[sourceField] ?? ""),
    );
    setDirty(false);
  };

  const put = async (overwrite: boolean): Promise<void> => {
    if (!draft) return;
    const id = String(draft["_id"] ?? "");
    if (!id.trim()) {
      setError("Nama wajib diisi.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Native has no atomic CAS: compare against a FRESH fetch before
      // saving unless the user explicitly chose to overwrite.
      if (!overwrite && selected && selected["_id"]) {
        const fresh = await fetchOne(id);
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(selected)) {
          conflictRef.current = () => {
            setConflictOpen(false);
            void put(true);
          };
          setConflictOpen(true);
          setBusy(false);
          return;
        }
      }
      let doc: Record<string, unknown>;
      if (config.deserialize) {
        try {
          doc = config.deserialize(source, draft);
        } catch (err) {
          setError(`Format tidak valid: ${(err as Error).message}`);
          setBusy(false);
          return;
        }
      } else {
        doc = { ...draft, [sourceField]: source };
      }
      const res = await fetch(
        `/api/app/resources/${resource}/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-App-Request": "1" },
          body: JSON.stringify(doc),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => null)) as ApiResult<unknown> | null;
        setError(
          body && body.ok === false
            ? `${body.error.message} (requestId ${body.requestId})`
            : "Resource tidak dapat disimpan.",
        );
      } else {
        setDirty(false);
        await load();
        await open(id);
      }
    } catch {
      setError("Resource tidak dapat disimpan — koneksi terputus.");
    }
    setBusy(false);
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/app/resources/${resource}/${encodeURIComponent(deleteTarget)}`,
        {
          method: "DELETE",
          headers: { "X-App-Request": "1" },
          cache: "no-store",
        },
      );
      if (!res.ok && res.status !== 404) {
        setError("Resource tidak dapat dihapus.");
      } else {
        setDeleteTarget(null);
        setSelected(null);
        setDraft(null);
        await load();
      }
    } catch {
      setError("Resource tidak dapat dihapus — koneksi terputus.");
    }
    setBusy(false);
  };

  const maskedSource = useMemo(() => {
    if (!selected) return source;
    return revealed ? source : maskValue(String(selected["_id"]), source);
  }, [selected, source, revealed]);

  if (state === "forbidden")
    return (
      <Status tone="warning">
        Anda tidak memiliki izin mengelola resource ini.
      </Status>
    );
  if (state === "error")
    return <Status tone="danger">Resource tidak dapat dimuat.</Status>;

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <Card>
        <CardContent className="space-y-2">
          <ul className="divide-y">
            {items.map((item) => (
              <li key={String(item["_id"])} className="py-1">
                <a
                  href={`/admin/${resource === "virtualParameters" ? "virtual-parameters" : resource}`}
                  onClick={(e) => {
                    e.preventDefault();
                    void open(String(item["_id"]));
                  }}
                  className="flex min-h-11 items-center break-all text-sm text-primary hover:underline"
                  aria-current={
                    selected?.["_id"] === item["_id"] ? "true" : undefined
                  }
                >
                  {String(item["_id"])}
                </a>
              </li>
            ))}
            {!items.length ? (
              <li className="py-2 text-xs text-muted-foreground">
                Belum ada entri.
              </li>
            ) : null}
          </ul>
          <Button variant="outline" size="sm" onClick={() => void open(null)}>
            Tambah
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3">
          {draft ? (
            <>
              <Field label="Nama" required>
                {({ id }) => (
                  <Input
                    id={id}
                    value={String(draft["_id"] ?? "")}
                    disabled={!!selected?.["_id"]}
                    aria-label="Nama"
                    onChange={(e) => {
                      setDraft({ ...draft, _id: e.target.value });
                      setDirty(true);
                    }}
                  />
                )}
              </Field>
              {maskedSource !== source ? (
                <div className="space-y-1">
                  <Status tone="warning">
                    Nilai tampak seperti kredensial dan disembunyikan.
                  </Status>
                  {canRevealSecrets ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRevealed((r) => !r)}
                    >
                      {revealed ? "Sembunyikan" : "Tampilkan nilai"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <CodeEditor
                value={maskedSource}
                language={language}
                readOnly={!revealed && maskedSource !== source}
                onChange={(next) => {
                  setSource(next);
                  setDirty(true);
                }}
              />
              {error ? <Status tone="warning">{error}</Status> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void put(false)}
                  busy={busy}
                  disabled={!dirty}
                >
                  Simpan
                </Button>
                {selected?.["_id"] ? (
                  <Button
                    variant="destructive"
                    onClick={() => setDeleteTarget(String(selected["_id"]))}
                    disabled={busy}
                  >
                    Hapus
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <Status tone="muted">Pilih entri di kiri atau Tambah.</Status>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={conflictOpen}
        onOpenChange={(open) => {
          if (!open) setConflictOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resource berubah sejak dimuat</DialogTitle>
            <DialogDescription>
              Entri ini dimodifikasi lain sejak Anda membukanya (native tidak
              menyediakan CAS atomik). Muat ulang untuk melihat versi terbaru,
              atau timpa secara eksplisit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConflictOpen(false);
                if (selected?.["_id"]) void open(String(selected["_id"]));
              }}
            >
              Muat ulang
            </Button>
            <Button onClick={() => conflictRef.current?.()}>Timpa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus {deleteTarget}?</DialogTitle>
            <DialogDescription>
              Tindakan ini permanen dan dijalankan lewat server.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => void remove()}
              busy={busy}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
