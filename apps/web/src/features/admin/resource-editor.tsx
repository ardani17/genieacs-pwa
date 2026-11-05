"use client";

// Generic admin resource editor (M06-B): list + create/edit/delete
// against the exact native resource shapes through the BFF resource
// routes (no second config DB). Unsaved changes guard navigation;
// saves re-fetch the resource and warn on concurrent modification
// (native has no atomic CAS — reload or explicit overwrite only).
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { maskValue, type ResourceEditorConfig } from "./resource-editor-shared";

// Left pane: the resource entry list. Each entry is a faux link (same
// page section) that opens the editor in place.
function ResourceListPane({
  resource,
  items,
  selectedId,
  onOpen,
}: {
  resource: string;
  items: Record<string, unknown>[];
  selectedId: unknown;
  onOpen: (id: string | null) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <ul className="divide-y">
          {items.map((item) => (
            <li key={String(item["_id"])} className="py-1">
              <a
                href={`/admin/${resource === "virtualParameters" ? "virtual-parameters" : resource}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(String(item["_id"]));
                }}
                className="flex min-h-11 items-center break-all text-sm text-primary hover:underline"
                aria-current={selectedId === item["_id"] ? "true" : undefined}
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
        <Button variant="outline" size="sm" onClick={() => onOpen(null)}>
          Tambah
        </Button>
      </CardContent>
    </Card>
  );
}

// Right pane: name field, (masked) source editor and actions.
function ResourceEditorPane({
  language,
  draft,
  hasExistingId,
  masked,
  maskedSource,
  revealed,
  canRevealSecrets,
  error,
  busy,
  dirty,
  onNameChange,
  onToggleReveal,
  onSourceChange,
  onSave,
  onDelete,
}: {
  language: CodeLanguage;
  draft: Record<string, unknown>;
  hasExistingId: boolean;
  masked: boolean;
  maskedSource: string;
  revealed: boolean;
  canRevealSecrets: boolean;
  error: string | null;
  busy: boolean;
  dirty: boolean;
  onNameChange: (value: string) => void;
  onToggleReveal: () => void;
  onSourceChange: (next: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <Field label="Nama" required>
          {({ id }) => (
            <Input
              id={id}
              value={String(draft["_id"] ?? "")}
              disabled={hasExistingId}
              aria-label="Nama"
              onChange={(e) => onNameChange(e.target.value)}
            />
          )}
        </Field>
        {masked ? (
          <div className="space-y-1">
            <Status tone="warning">
              Nilai tampak seperti kredensial dan disembunyikan.
            </Status>
            {canRevealSecrets ? (
              <Button variant="outline" size="sm" onClick={onToggleReveal}>
                {revealed ? "Sembunyikan" : "Tampilkan nilai"}
              </Button>
            ) : null}
          </div>
        ) : null}
        <CodeEditor
          value={maskedSource}
          language={language}
          readOnly={!revealed && masked}
          onChange={onSourceChange}
        />
        {error ? <Status tone="warning">{error}</Status> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSave} busy={busy} disabled={!dirty}>
            Simpan
          </Button>
          {hasExistingId ? (
            <Button variant="destructive" onClick={onDelete} disabled={busy}>
              Hapus
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

// Shared confirmation dialog shell for the conflict and delete flows.
function EditorDialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  footer: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
          return;
        }
      }
      let doc: Record<string, unknown>;
      if (config.deserialize) {
        try {
          doc = config.deserialize(source, draft);
        } catch (err) {
          setError(`Format tidak valid: ${(err as Error).message}`);
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
    } finally {
      setBusy(false);
    }
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
    } finally {
      setBusy(false);
    }
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
      <ResourceListPane
        resource={resource}
        items={items}
        selectedId={selected?.["_id"]}
        onOpen={(id) => void open(id)}
      />
      {draft ? (
        <ResourceEditorPane
          language={language}
          draft={draft}
          hasExistingId={!!selected?.["_id"]}
          masked={maskedSource !== source}
          maskedSource={maskedSource}
          revealed={revealed}
          canRevealSecrets={canRevealSecrets}
          error={error}
          busy={busy}
          dirty={dirty}
          onNameChange={(value) => {
            setDraft({ ...draft, _id: value });
            setDirty(true);
          }}
          onToggleReveal={() => setRevealed((r) => !r)}
          onSourceChange={(next) => {
            setSource(next);
            setDirty(true);
          }}
          onSave={() => void put(false)}
          onDelete={() => setDeleteTarget(String(selected?.["_id"]))}
        />
      ) : (
        <Card>
          <CardContent className="space-y-3">
            <Status tone="muted">Pilih entri di kiri atau Tambah.</Status>
          </CardContent>
        </Card>
      )}
      <EditorDialog
        open={conflictOpen}
        onOpenChange={(open) => {
          if (!open) setConflictOpen(false);
        }}
        title="Resource berubah sejak dimuat"
        description="Entri ini dimodifikasi lain sejak Anda membukanya (native tidak menyediakan CAS atomik). Muat ulang untuk melihat versi terbaru, atau timpa secara eksplisit."
        footer={
          <>
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
          </>
        }
      />
      <EditorDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Hapus ${deleteTarget}?`}
        description="Tindakan ini permanen dan dijalankan lewat server."
        footer={
          <Button
            variant="destructive"
            onClick={() => void remove()}
            busy={busy}
          >
            Hapus
          </Button>
        }
      />
    </div>
  );
}
