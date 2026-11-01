"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

// First-run setup maps the NATIVE /init flow: it is only usable while
// the installation has no users; once users exist the native admin
// permissions govern and this page shows a locked notice (no public
// reset path exists).
export default function SetupPage() {
  const [state, setState] = useState<
    "checking" | "available" | "locked" | "error"
  >("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app/setup", { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        if (body?.ok) setState(body.data.available ? "available" : "locked");
        else setState("error");
      })
      .catch(() => setState("error"));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || state !== "available") return;
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password !== confirm) {
      setMessage("Konfirmasi password tidak sama.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/app/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: window.location.origin,
          "X-App-Request": "1",
        },
        body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (res.ok && body?.ok) {
        setState("locked");
        setMessage("Admin berhasil dibuat. Silakan masuk.");
        (e.target as HTMLFormElement).reset();
      } else {
        setMessage(body?.error?.message ?? "Gagal membuat admin.");
      }
    } catch {
      setMessage("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <h1>Penyiapan Awal</h1>
      {state === "checking" ? <Status tone="muted">Memeriksa…</Status> : null}
      {state === "locked" ? (
        <Status tone="warning">
          Instalasi sudah memiliki pengguna. Penyiapan awal terkunci.
        </Status>
      ) : null}
      {state === "error" ? (
        <Status tone="danger">Tidak dapat menghubungi server.</Status>
      ) : null}
      {state === "available" ? (
        <form onSubmit={onSubmit} noValidate>
          <Field label="Nama pengguna admin" required>
            {({ id }) => <input id={id} value="admin" readOnly />}
          </Field>
          <Field label="Password admin" required>
            {({ id }) => (
              <input
                id={id}
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            )}
          </Field>
          <Field label="Konfirmasi password" required>
            {({ id }) => (
              <input
                id={id}
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            )}
          </Field>
          {message ? <Status tone="danger">{message}</Status> : null}
          <Button type="submit" busy={busy}>
            Buat admin
          </Button>
        </form>
      ) : null}
      {state === "locked" && message ? (
        <Status tone="success">{message}</Status>
      ) : null}
    </main>
  );
}
