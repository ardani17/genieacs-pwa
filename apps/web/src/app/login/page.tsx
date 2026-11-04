"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthPanel } from "@/components/auth-panel";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return; // no duplicate submit
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: window.location.origin,
          "X-App-Request": "1",
        },
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      const body = await res.json();
      if (res.ok && body?.ok) {
        router.push("/overview");
        return;
      }
      setError(
        body?.error?.code === "RATE_LIMITED"
          ? "Terlalu banyak percobaan gagal. Coba lagi nanti."
          : "Nama pengguna atau password salah.",
      );
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPanel
      title="Masuk"
      description="Masuk ke ruang kerja untuk memantau dan mengelola perangkat Anda."
    >
      <form onSubmit={onSubmit} className="form-stack" noValidate>
        <Field label="Nama pengguna" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="username"
              autoComplete="username"
              aria-describedby={describedBy}
              required
            />
          )}
        </Field>
        <Field label="Password" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              name="password"
              type="password"
              autoComplete="current-password"
              aria-describedby={describedBy}
              required
            />
          )}
        </Field>
        {error ? <Status tone="danger">{error}</Status> : null}
        <Button type="submit" busy={busy}>
          Masuk
        </Button>
      </form>
    </AuthPanel>
  );
}
