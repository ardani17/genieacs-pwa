"use client";

// Tag editor (M05-E): add/remove through the native tag route; the
// server re-checks devices:3 + validator per action. No customer/CRM
// semantics — plain device tags.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { Input } from "@/components/ui/input";
import type { ApiResult } from "@contracts/api.ts";

export function TagEditor({ deviceId }: { deviceId: string }) {
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deviceRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/app/devices/${encodeURIComponent(deviceId)}`,
            { cache: "no-store" },
          );
          if (!res.ok) return; // tags stay empty on read failure
          const body = (await res.json()) as ApiResult<Record<string, unknown>>;
          if (body.ok !== true) return;
          deviceRef.current = body.data;
          setTags(
            Object.keys(body.data)
              .filter((k) => k.startsWith("Tags.") && k !== "Tags")
              .map((k) => k.slice(5)),
          );
        } catch {
          // tags stay empty on read failure; actions surface errors
        }
      })();
    }, 0);
    return () => window.clearTimeout(t);
  }, [deviceId]);

  const mutate = async (name: string, value: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/app/devices/${encodeURIComponent(deviceId)}/tags`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-App-Request": "1" },
          body: JSON.stringify({ [name]: value }),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        // Non-2xx still carries the typed envelope; unparseable bodies
        // fall through to the catch below (same as before).
        const errBody = (await res.json()) as ApiResult<unknown>;
        if (errBody.ok !== true) setError(errBody.error.message);
        return;
      }
      const body = (await res.json()) as ApiResult<unknown>;
      if (body.ok !== true) {
        setError(body.error.message);
      } else {
        setTags((prev) =>
          value
            ? prev.includes(name)
              ? prev
              : [...prev, name]
            : prev.filter((t) => t !== name),
        );
        setTag("");
      }
    } catch {
      setError("Tags tidak dapat diperbarui — koneksi terputus.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex min-h-(--control-height-sm) items-center gap-2 rounded-full border px-3 text-sm"
          >
            {t}
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Hapus tag ${t}`}
              disabled={busy}
              onClick={() => void mutate(t, false)}
            >
              ×
            </Button>
          </span>
        ))}
        {!tags.length ? <Status tone="muted">Belum ada tag.</Status> : null}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Tag baru"
          value={tag}
          placeholder="nama-tag"
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tag.trim()) void mutate(tag.trim(), true);
          }}
        />
        <Button
          disabled={busy || !tag.trim()}
          onClick={() => void mutate(tag.trim(), true)}
        >
          Tambah tag
        </Button>
      </div>
      {error ? <Status tone="warning">{error}</Status> : null}
    </div>
  );
}
