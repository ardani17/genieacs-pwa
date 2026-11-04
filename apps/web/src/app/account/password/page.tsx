"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthPanel } from "@/components/auth-panel";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

export default function AccountPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (newPassword !== confirm) {
      setMessage({ tone: "danger", text: "Konfirmasi password tidak sama." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/app/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: window.location.origin,
          "X-App-Request": "1",
        },
        body: JSON.stringify({
          oldPassword: String(form.get("oldPassword") ?? ""),
          newPassword,
        }),
      });
      const body = await res.json();
      if (res.ok && body?.ok) {
        setMessage({ tone: "success", text: "Password berhasil diganti." });
        // Clear the form fields from memory immediately.
        (e.target as HTMLFormElement).reset();
        return;
      }
      setMessage({
        tone: "danger",
        text:
          body?.error?.code === "VALIDATION"
            ? "Password baru tidak memenuhi kebijakan."
            : "Password saat ini salah.",
      });
    } catch {
      setMessage({ tone: "danger", text: "Tidak dapat menghubungi server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPanel
      title="Ganti Password"
      description="Perbarui password akun Anda. Gunakan password yang kuat dan unik."
    >
      <form onSubmit={onSubmit} className="form-stack" noValidate>
        <Field label="Password saat ini" required>
          {({ id }) => (
            <Input
              id={id}
              name="oldPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>
        <Field label="Password baru" required>
          {({ id }) => (
            <Input
              id={id}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          )}
        </Field>
        <Field label="Konfirmasi password baru" required>
          {({ id }) => (
            <Input
              id={id}
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          )}
        </Field>
        {message ? <Status tone={message.tone}>{message.text}</Status> : null}
        <Button type="submit" busy={busy}>
          Simpan
        </Button>
        <a
          href="/overview"
          className="flex min-h-11 items-center justify-center text-sm font-medium text-primary hover:underline"
        >
          Kembali ke ringkasan
        </a>
      </form>
    </AuthPanel>
  );
}
