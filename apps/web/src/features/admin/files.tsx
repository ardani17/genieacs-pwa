"use client";

// Firmware/file management (M06-C): metadata list, streaming upload
// (≤100MiB via the M02-B file route) with progress/abort through XHR,
// permissioned download/delete. Firmware tasks reference the
// FS_URL_PREFIX the ONT can reach — never the browser URL.
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiResult } from "@contracts/api.ts";

interface FileRow {
  _id: string;
  metadata: {
    fileType?: string;
    version?: string;
    oui?: string;
    productClass?: string;
    length?: number;
  };
}

export function FileManager() {
  const [rows, setRows] = useState<FileRow[]>([]);
  const [state, setState] = useState<
    "loading" | "ready" | "forbidden" | "error"
  >("loading");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [fileId, setFileId] = useState("");
  const [fileType, setFileType] = useState("1 Firmware Upgrade Image");
  const [version, setVersion] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setState("loading");
    const res = await fetch("/api/app/resources/files?page=1&pageSize=100", {
      cache: "no-store",
    });
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
      body.data.items.map((f) => ({
        _id: String(f["_id"]),
        metadata: (f["metadata"] as FileRow["metadata"]) ?? {},
      })),
    );
    setState("ready");
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const upload = (file: File): void => {
    if (!fileId.trim()) {
      setError("ID file wajib diisi.");
      return;
    }
    setUploading(true);
    setError(null);
    setProgress(0);
    // XHR gives upload progress; fetch does not. The file streams to
    // the native endpoint — never buffered whole in the browser.
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("PUT", `/api/app/files/${encodeURIComponent(fileId)}/content`);
    xhr.setRequestHeader("X-App-Request", "1");
    xhr.setRequestHeader("metadata-filetype", fileType);
    xhr.setRequestHeader("metadata-version", version);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      setProgress(null);
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        setFileId("");
        setVersion("");
        void load();
      } else {
        setError(`Upload gagal (${xhr.status}).`);
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setProgress(null);
      xhrRef.current = null;
      setError("Upload gagal — koneksi terputus.");
    };
    xhr.onabort = () => {
      setUploading(false);
      setProgress(null);
      xhrRef.current = null;
    };
    xhr.send(file);
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget || deleting || uploading) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/app/resources/files/${encodeURIComponent(deleteTarget)}`,
        {
          method: "DELETE",
          headers: { "X-App-Request": "1" },
          cache: "no-store",
        },
      );
      if (!res.ok) setError("File tidak dapat dihapus.");
      else {
        setDeleteTarget(null);
        await load();
      }
    } catch {
      setError("File tidak dapat dihapus — koneksi terputus.");
    } finally {
      setDeleting(false);
    }
  };

  if (state === "forbidden")
    return (
      <Status tone="warning">Anda tidak memiliki izin mengelola file.</Status>
    );
  if (state === "error")
    return <Status tone="danger">File tidak dapat dimuat.</Status>;

  return (
    <div className="space-y-4">
      {error ? <Status tone="warning">{error}</Status> : null}
      <Card>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Field label="ID file" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={fileId}
                  placeholder="mis. firmware-f670-p3n19"
                  onChange={(e) => setFileId(e.target.value)}
                />
              )}
            </Field>
            <Field label="Tipe file">
              {({ id }) => (
                <Input
                  id={id}
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value)}
                />
              )}
            </Field>
            <Field label="Versi">
              {({ id }) => (
                <Input
                  id={id}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <label className="cursor-pointer">
                Pilih file firmware
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
            {uploading ? (
              <>
                <span aria-live="polite" className="text-sm">
                  Mengunggah {progress ?? 0}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => xhrRef.current?.abort()}
                >
                  Batalkan
                </Button>
              </>
            ) : null}
          </div>
          <ul className="divide-y">
            {rows.map((row) => (
              <li
                key={row._id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="break-all font-medium">{row._id}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.metadata.fileType ?? "—"} · v
                    {row.metadata.version ?? "?"}
                    {row.metadata.length != null
                      ? ` · ${row.metadata.length} B`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={`/api/app/files/${encodeURIComponent(row._id)}/content`}
                    className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-primary hover:underline"
                  >
                    Unduh
                  </a>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteTarget(row._id)}
                  >
                    Hapus
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus file {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              Task firmware yang masih memakai file ini akan gagal mengunduh —
              periksa device aktif sebelum menghapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <Status tone="warning">{error}</Status> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={uploading || deleting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
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
